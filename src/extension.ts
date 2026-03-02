import * as vscode from "vscode";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { dirname, extname, basename, relative, resolve } from "node:path";
import { promises as fs } from "node:fs";

////////////////////////////////////////////////////////////////////////////////

function getSourceCommentPath(originalPath: string, configDir?: string, include?: string[]): string {
	if (!configDir) {
		return originalPath.replace(/\\/g, '/');
	}

	const configDirResolved = resolve(configDir);
	const originalPathResolved = resolve(originalPath);

	const relativePath = relative(configDirResolved, originalPathResolved);
	if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
		return relativePath.replace(/\\/g, '/');
	}

	if (include && include.length > 0) {
		for (const inc of include) {
			const includePath = resolve(configDir, inc);
			const relativePath = relative(includePath, originalPathResolved);

			if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
				return relativePath.replace(/\\/g, '/');
			}
		}
	}

	return originalPath.replace(/\\/g, '/');
}

function updateDiagnostics(diagnostics: vscode.DiagnosticCollection, activeEditor: vscode.TextEditor, messages: [string, string, number, number][]) {
	if (!(messages instanceof Array) || messages.length === 0) {
		diagnostics.set(activeEditor.document.uri, []);
		return;
	}

	const diags: vscode.Diagnostic[] = [];

	const globalMap = new Map<string, string[]>();
	const others: [string, string, number, number][] = [];

	for (const message of messages) {
		const [type, msg, line, column] = message;
		if (type === "global") {
			const key = `${line}:${column}`;
			if (!globalMap.has(key)) {
				globalMap.set(key, []);
			}
			globalMap.get(key)!.push(msg);
		} else {
			others.push(message);
		}
	}

	for (const [key, msgArr] of globalMap) {
		const [lineStr, colStr] = key.split(":");
		const line = Number(lineStr);
		const column = Number(colStr);
		const msg = `use of undeclared global variable: ${msgArr.join(", ")}`;
		const range = activeEditor.document.getWordRangeAtPosition(new vscode.Position(line - 1, column - 1));
		diags.push(new vscode.Diagnostic(
			range ?? new vscode.Range(line - 1, column - 1, line - 1, column),
			msg,
			vscode.DiagnosticSeverity.Warning,
		));
	}

	for (const message of others) {
		const [, msg, line, column] = message;
		const range = activeEditor.document.getWordRangeAtPosition(new vscode.Position(line - 1, column - 1));
		diags.push(new vscode.Diagnostic(
			range ?? new vscode.Range(line - 1, column - 1, line - 1, column),
			msg,
			vscode.DiagnosticSeverity.Error,
		));
	}

	diagnostics.set(activeEditor.document.uri, diags);
}

export async function activate(context: vscode.ExtensionContext) {
	const yueProcess: ChildProcessByStdio<Writable, Readable, null> = spawn("yue", ["-e", context.extensionPath + "/src/server.yue"], {
		stdio: ["pipe", "pipe", "inherit"],
	});

	context.subscriptions.push({
		dispose() {
			yueProcess.stdin.end();
			if (!yueProcess.killed) {
				yueProcess.kill();
			}
		}
	});

	const diagnostics = vscode.languages.createDiagnosticCollection("YueScript");
	context.subscriptions.push(diagnostics);

	const yueConfigWatcher = vscode.workspace.createFileSystemWatcher("**/yueconfig.yue");
	context.subscriptions.push(yueConfigWatcher);
	context.subscriptions.push(yueConfigWatcher.onDidCreate((uri) => invalidateYueConfigCaches(uri.fsPath)));
	context.subscriptions.push(yueConfigWatcher.onDidChange((uri) => invalidateYueConfigCaches(uri.fsPath)));
	context.subscriptions.push(yueConfigWatcher.onDidDelete((uri) => invalidateYueConfigCaches(uri.fsPath)));

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
		if (document.languageId !== "yuescript") {
			return;
		}

		if (basename(document.uri.fsPath).toLowerCase() === "yueconfig.yue") {
			invalidateYueConfigCaches(document.uri.fsPath);
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || activeEditor.document !== document) {
			return;
		}

		const reply = await textChangeCallback({
			extensionContext: context,
			activeEditor,
			yueProcess,
			isSaveEvent: true,
		});

		if (reply === null) {
			return;
		}

		updateDiagnostics(diagnostics, activeEditor, reply.messages);

		if (basename(document.uri.fsPath).toLowerCase() === "yueconfig.yue") {
			return;
		}

		if (reply.build && reply.transpiledLuaCode) {
			const originalPath = document.uri.fsPath;
			const luaPath = dirname(originalPath) + '/' + basename(originalPath, extname(originalPath)) + '.lua';

			const sourcePath = getSourceCommentPath(originalPath, reply.configDir, reply.include);
			const commentLine = `-- [yue]: ${sourcePath}\n`;

			try {
				await fs.writeFile(luaPath, commentLine + reply.transpiledLuaCode, 'utf8');
			} catch (error) {
				console.error(`Failed to write Lua file to ${luaPath}:`, error);
			}
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
		const activeEditor = vscode.window.activeTextEditor;
		if (event.contentChanges.length === 0 || (!activeEditor) || (event.document !== activeEditor.document) || (activeEditor.document.languageId !== "yuescript")) {
			return;
		}

		const reply = await textChangeCallback({
			extensionContext: context,
			activeEditor,
			yueProcess,
			isSaveEvent: false,
		});

		if (reply === null) {
			return;
		}

		updateDiagnostics(diagnostics, activeEditor, reply.messages);
	}));
}

export function deactivate() {}

////////////////////////////////////////////////////////////////////////////////

interface YueReply {
	success: boolean;
	transpiledLuaCode?: string;
	messages: [string, string, number, number][];
	include?: string[];
	configDir?: string;
	build?: boolean;
};

interface YueConfig {
	content: string;
	dir: string;
	module: string;
}

interface NearestYueConfig {
	content: string;
	dir: string;
}

let yueTaskQueue: Promise<void> = Promise.resolve();
let yueStdoutBuffer = "";
const nearestConfigLookupCache = new Map<string, NearestYueConfig | null>();
const configContentCache = new Map<string, string>();

function enqueueYueTask<T>(task: () => Promise<T>): Promise<T> {
	const run = yueTaskQueue.then(task, task);
	yueTaskQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function invalidateYueConfigCaches(configPath?: string) {
	if (configPath) {
		configContentCache.delete(configPath);
	}
	nearestConfigLookupCache.clear();
}

function readYueReplyLine(yueProcess: ChildProcessByStdio<Writable, Readable, null>): Promise<string> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			yueProcess.stdout.off("data", onData);
			yueProcess.stdout.off("error", onError);
			yueProcess.stdout.off("close", onClose);
		};

		const tryConsumeLine = () => {
			const newlineIndex = yueStdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) {
				return false;
			}

			const line = yueStdoutBuffer.slice(0, newlineIndex);
			yueStdoutBuffer = yueStdoutBuffer.slice(newlineIndex + 1);
			cleanup();
			resolve(line);
			return true;
		};

		const onData = (chunk: Buffer | string) => {
			yueStdoutBuffer += chunk instanceof Buffer ? chunk.toString("utf8") : chunk;
			tryConsumeLine();
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onClose = () => {
			cleanup();
			reject(new Error("Yue process stdout closed before a complete reply was received."));
		};

		if (tryConsumeLine()) {
			return;
		}

		yueProcess.stdout.on("data", onData);
		yueProcess.stdout.once("error", onError);
		yueProcess.stdout.once("close", onClose);
	});
}

async function findNearestYueConfig(documentUri: vscode.Uri): Promise<NearestYueConfig | undefined> {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
	const workspaceRoot = workspaceFolder?.uri.fsPath;
	const startDir = dirname(documentUri.fsPath);
	const cacheKey = workspaceRoot ? `${workspaceRoot}::${startDir}` : startDir;

	if (nearestConfigLookupCache.has(cacheKey)) {
		const cached = nearestConfigLookupCache.get(cacheKey);
		if (!cached) {
			return undefined;
		}
		return {
			content: cached.content,
			dir: cached.dir,
		};
	}

	let currentDir = startDir;
	while (true) {
		const configPath = resolve(currentDir, "yueconfig.yue");
		let content = configContentCache.get(configPath);
		if (content === undefined) {
			try {
				content = await fs.readFile(configPath, "utf8");
				configContentCache.set(configPath, content);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT") {
					console.error(`Failed to read yueconfig.yue at ${configPath}:`, error);
				}
			}
		}
		if (content !== undefined) {
			const config = {
				content,
				dir: currentDir,
			};
			nearestConfigLookupCache.set(cacheKey, config);
			return config;
		}

		if ((workspaceRoot && currentDir === workspaceRoot) || dirname(currentDir) === currentDir) {
			break;
		}
		currentDir = dirname(currentDir);
	}

	nearestConfigLookupCache.set(cacheKey, null);
	return undefined;
}

async function textChangeCallback({
	activeEditor,
	yueProcess,
	isSaveEvent,
}: {
	extensionContext: vscode.ExtensionContext,
	activeEditor: vscode.TextEditor,
	yueProcess: ChildProcessByStdio<Writable, Readable, null>,
	isSaveEvent: boolean,
}): Promise<YueReply | null> {
	return enqueueYueTask(async () => {
		const nearestConfig = await findNearestYueConfig(activeEditor.document.uri);

		const dataToSend: { sourceCode: string; config?: YueConfig; isSaveEvent?: boolean } = {
			sourceCode: activeEditor.document.getText().trimEnd(),
		};
		if (isSaveEvent) {
			dataToSend.isSaveEvent = true;
		}
		if (nearestConfig) {
			dataToSend.config = {
				content: nearestConfig.content,
				dir: nearestConfig.dir,
				module: relative(nearestConfig.dir, activeEditor.document.fileName),
			};
		}

		return await new Promise<YueReply>((resolve, reject) => {
			const callback = () => {
				process.nextTick(async () => {
					let replyText: string;
					try {
						replyText = await readYueReplyLine(yueProcess);
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
						return;
					}

					try {
						const reply = JSON.parse(replyText) as YueReply;
						resolve(reply);
					} catch (err) {
						reject(new Error(`${err} -> ${replyText}`));
					}
				});
			};

			if (!yueProcess.stdin.write(JSON.stringify(dataToSend) + "\n")) {
				yueProcess.stdin.once("drain", callback);
			} else {
				callback();
			}
		});
	});
}
