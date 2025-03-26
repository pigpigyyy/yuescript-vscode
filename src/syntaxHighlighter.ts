type AstNode = {
	startPos: number,
	endPos: number,
	tagName: string,
	children: AstNode[],
};

async function parse(source: string): Promise<AstNode> {
	// TODO: Replace this placeholder with an actual implementation that uses
	// `yue.to_ast()` from a Lua interpreter, serialized to JSON.
	return {
		startPos: 0,
		endPos: source.length,
		tagName: "root",
		children: [],
	};
}

export async function highlightSyntax(source: string) {
	try {
		const ast = await parse(source);

		// Process the AST and extract syntax highlighting info.
		// This part should return a list of ranges and styles.
		return [];
	} catch (error) {
		console.error("Syntax highlighting failed:", error);
		return [];
	}
}
