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
	for (const message of messages) {
		let [type, msg, line, column] = message;
		if (type === "global") {
			msg = `use of undeclared global variable '${msg}'`;
		}
		const range = activeEditor.document.getWordRangeAtPosition(new vscode.Position(line - 1, column - 1));
		diags.push(new vscode.Diagnostic(
			range ?? new vscode.Range(line - 1, column - 1, line - 1, column),
			msg,
			type === "global" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
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

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
		if (document.languageId !== "yuescript") {
			return;
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

function typeName(object: any) {
	const type = typeof object;

	return type === "object"
		? (object?.constructor?.name ?? "object")
		: type;
}

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
}

let locked = false;
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
	return new Promise(async (resolve, reject) => {
		if (locked) {
			resolve(null);
			return;
		}

		locked = true;

		// find yueconfig.yue
		let yueConfigContent: string | undefined = undefined;
		let yueConfigDir: string | undefined = undefined;
		try {
			const configFiles = await vscode.workspace.findFiles("**/yueconfig.yue", '**/node_modules/**', 1);
			if (configFiles.length > 0 && configFiles[0]) {
				const configDocument = await vscode.workspace.openTextDocument(configFiles[0]);
				yueConfigContent = configDocument.getText();
				yueConfigDir = dirname(configFiles[0].fsPath);
			}
		} catch (error) {
			console.error("Failed to find or read yueconfig.yue:", error);
		}

		const dataToSend: { sourceCode: string; config?: YueConfig; isSaveEvent?: boolean } = {
			sourceCode: activeEditor.document.getText().trimEnd(),
		};
		if (isSaveEvent) {
			dataToSend.isSaveEvent = true;
		}
		if (yueConfigContent !== undefined && yueConfigDir !== undefined) {
			dataToSend.config = {
				content: yueConfigContent,
				dir: yueConfigDir,
			};
		}

		const callback = () => {
			process.nextTick(() => {
				yueProcess.stdout.once("data", (data: Buffer) => {
					locked = false;
					if (data instanceof Buffer) {
						let reply: YueReply;
						try {
							reply = JSON.parse(String(data));
						} catch (err) {
							throw new Error(`${err} -> ${String(data)}`);
						}
						resolve(reply);
					} else {
						reject(`Invalid type of data! (Buffer expected, got ${typeName(data)} - ${data})`);
					}
				});
			});
		};

		if (!yueProcess.stdin.write(JSON.stringify(dataToSend) + "\n")) {
			yueProcess.stdin.once("drain", callback);
		} else {
			callback();
		}
	});
}
