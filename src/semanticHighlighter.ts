import * as vscode from "vscode";
import {
	Position,
	Range,
	SemanticTokensLegend,
	SemanticTokensBuilder,
	type DocumentSemanticTokensProvider,
	type TextDocument,
	type ProviderResult,
	type SemanticTokens,
} from "vscode";

const tokenTypes = [
	"class",
	"function",
	"variable",
];

const tokenModifiers = [
	"declaration",
];

const legend = new SemanticTokensLegend(tokenTypes, tokenModifiers);

const provider: DocumentSemanticTokensProvider = {
	provideDocumentSemanticTokens(
		document: TextDocument,
	): ProviderResult<SemanticTokens> {
		const tokensBuilder = new SemanticTokensBuilder(legend);

		//vscode.window.showInformationMessage("Hello from semanticHighlighter.ts!");

		//*
		// on line 1, characters 1-5 are a class declaration
		tokensBuilder.push(
			new Range(
				new Position(1, 1),
				new Position(1, 5)
			),
			"class",
			[
				"declaration",
			],
		);
		//*/

		return tokensBuilder.build();
	},
};

const selector = {
	language: "yuescript",
	scheme: "file",
};

vscode.languages.registerDocumentSemanticTokensProvider(
	selector,
	provider,
	legend,
);
