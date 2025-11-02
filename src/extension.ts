import * as vscode from "vscode";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

////////////////////////////////////////////////////////////////////////////////

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

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
		const activeEditor = vscode.window.activeTextEditor;

		if ((!activeEditor) || (event.document !== activeEditor.document)) {
			return;
		}

		const rawReply = await textChangeCallback({
			extensionContext: context,
			activeEditor,
			yueProcess,
		});
		if (rawReply === null) {
			return;
		}

		let reply;
		try {
			reply = JSON.parse(rawReply);
		} catch (err) {
			throw new Error(`${err} -> ${rawReply}`);
		}

		diagnostics.clear();

		if (!reply || typeof reply !== "object" || reply["success"] || !reply["error"]) {
			return;
		}

		const [[node, message, line, column]] = reply["error"];
		if (node !== "error") {
			throw new Error(`Invalid node '${node}'!`);
		}
		if (typeof message !== "string") {
			throw new TypeError(`typeof message === '${typeof message}'`);
		}
		if (typeof line !== "number") {
			throw new TypeError(`typeof line === '${typeof line}'`);
		}
		if (typeof column !== "number") {
			throw new TypeError(`typeof column === '${typeof column}'`);
		}

		diagnostics.set(activeEditor.document.uri, [new vscode.Diagnostic(
			new vscode.Range(line - 1, column - 1, line - 1, column),
			message,
			vscode.DiagnosticSeverity.Error,
		)]);
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

let locked = false;
function textChangeCallback({
	extensionContext,
	activeEditor,
	yueProcess,
}: {
	extensionContext: vscode.ExtensionContext,
	activeEditor: vscode.TextEditor,
	yueProcess: ChildProcessByStdio<Writable, Readable, null>,
}): Promise<string | null> {
	return new Promise((resolve, reject) => {
		if (locked) {
			resolve(null);
			return;
		}

		locked = true;

		const callback = () => {
			process.nextTick(() => {
				yueProcess.stdout.once("data", (data: Buffer) => {
					locked = false;
					if (data instanceof Buffer) {
						resolve(String(data));
					} else {
						reject(`Invalid type of data! (Buffer expected, got ${typeName(data)} - ${data})`);
					}
				});
			});
		};

		if (!yueProcess.stdin.write(JSON.stringify({
			sourceCode: activeEditor.document.getText().trimEnd(),
		}) + "\n")) {
			yueProcess.stdin.once("drain", callback);
		} else {
			callback();
		}
	});
}
