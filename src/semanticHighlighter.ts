import * as vscode from "vscode";
import {
	Position,
	Range,
	SemanticTokensLegend,
	SemanticTokensBuilder,
	type DocumentSelector,
	type DocumentSemanticTokensProvider,
	type TextDocument,
	type ProviderResult,
	type SemanticTokens,
} from "vscode";

const selector: DocumentSelector = {
	language: "YueScript",
	scheme: "file",
};

const provider: DocumentSemanticTokensProvider = {
	provideDocumentSemanticTokens(document: TextDocument): ProviderResult<SemanticTokens> {
		const tokensBuilder = new SemanticTokensBuilder(legend);

		//vscode.window.showInformationMessage("Hello from semanticHighlighter.ts!");

		/*// Example: on line 1, characters 1-5 are a class declaration
		tokensBuilder.push(
			new Range(
				new Position(1, 1),
				new Position(1, 5)
			),
			"class",
			[
				"declaration",
			],
		);*/

		return tokensBuilder.build();
	},
};

const tokenTypes = [
	"class",
	"function",
	"variable",
];

const tokenModifiers = [
	"declaration",
];

const legend = new SemanticTokensLegend(tokenTypes, tokenModifiers);

export function registerSemanticHighlighter(): vscode.Disposable {
	return vscode.languages.registerDocumentSemanticTokensProvider(
		selector,
		provider,
		legend,
	);
}
