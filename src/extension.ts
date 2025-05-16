import * as vscode from "vscode";
import { highlightSyntax } from "./syntaxHighlighter";
import {} from "./semanticHighlighter";

const disposables: { dispose(): void; }[] = [];

class Logger {
	readonly #outputChannel: vscode.OutputChannel;
	#isDisposed: boolean;

	private constructor(
		outputChannel: vscode.OutputChannel,
		isDisposed: boolean,
	) {
		this.#outputChannel = outputChannel;
		this.#isDisposed = isDisposed;
	}

	public static new(context: vscode.ExtensionContext) {
		const outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("YueScript");
		outputChannel.show();
		context.subscriptions.push(outputChannel);
		disposables.push(outputChannel);

		return new this(outputChannel, false);
	}

	public dispose() {
		if (this.#isDisposed) return;
		this.#outputChannel.dispose();
	}

	public [Symbol.dispose]() {
		this.dispose();
	}

	public info() {
		const date: string = new Date(Date.now()).toISOString();

		this
			.#outputChannel
			.appendLine(`[${date}] Extension activated.`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("YueScript");
	outputChannel.appendLine(`[${new Date(Date.now()).toISOString()}] Extension activated.`);
	outputChannel.show();
	context.subscriptions.push(outputChannel);
	disposables.push(outputChannel);

	//*
	const disposable: vscode.Disposable = vscode.commands.registerCommand(
		"yuescript.highlightSyntax",
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (editor === undefined) {
				vscode.window.showErrorMessage("No active text editor.");
				return;
			}

			const document = editor.document;
			const sourceCode = document.getText();
			const decorations = await highlightSyntax(sourceCode);

			// TODO: Apply decorations (syntax highlighting)
			// Example: editor.setDecorations(someDecorationType, decorations);
		}
	);

	context.subscriptions.push(disposable);
	disposables.push(disposable);
	//*/
}

export function deactivate() {
	disposables.forEach(v => v.dispose());
}
