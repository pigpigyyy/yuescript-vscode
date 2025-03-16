import * as vscode from "vscode";
import { highlightSyntax } from "./syntaxHighlighter";

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand(
		"extension.highlightSyntax",
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
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
}

export function deactivate() { }
