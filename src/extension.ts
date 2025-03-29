import * as vscode from "vscode";
//import { highlightSyntax } from "./syntaxHighlighter";
import {} from "./semanticHighlighter";

export function activate(context: vscode.ExtensionContext) {
	/*
	const disposable = vscode.commands.registerCommand(
		"yuescript.highlightSyntax",
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (editor == null) {
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
	//*/
}

export function deactivate() {}
