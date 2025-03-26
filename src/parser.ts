const luaKeywords = new Set([
	"and", "break", "do", "else", "elseif",
	"end", "false", "for", "function", "goto",
	"if", "in", "local", "nil", "not",
	"or", "repeat", "return", "then", "true",
	"until", "while",
]);

const yueKeywords = new Set([
	"as", "class", "continue", "export", "extends",
	"from", "global", "import", "macro", "switch",
	"try", "unless", "using", "when", "with",
]);

const keywords = luaKeywords.union(yueKeywords);

type ParseInfoError = {
	msg: string;
	line: number;
	col: number;
};

type AstNode = { /* TODO */ };

type Input = { /* TODO */ };

type ParseInfo = {
	node: AstNode;
	error?: ParseInfoError;
	codes: Input;
	exportDefault: boolean;
	exportMacro: boolean;
	exportMetatable: boolean;
	moduleName: string;
	usedNames: Set;
	errorMessage: string;
};

class YueParser {
	constructor() { /* TODO */ }
}
