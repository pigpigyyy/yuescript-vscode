import * as vscode from "vscode";

const LUA_LINE_COMMENT = /--\s*(\d+)\s*$/;

export interface LuaLineMap {
	luaToYue: Array<number | undefined>;
	yueToLua: Map<number, number>;
}

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export function parseLuaLineMap(luaText: string): LuaLineMap {
	const lines = luaText.split("\n");
	const luaToYue: Array<number | undefined> = new Array(lines.length);
	const yueToLua = new Map<number, number>();

	for (let luaLine = 0; luaLine < lines.length; luaLine++) {
		const line = lines[luaLine]!;
		const match = line.match(LUA_LINE_COMMENT);
		if (!match) {
			continue;
		}
		const yueLine = Number(match[1]) - 1;
		if (Number.isNaN(yueLine) || yueLine < 0) {
			continue;
		}
		luaToYue[luaLine] = yueLine;
		if (!yueToLua.has(yueLine)) {
			yueToLua.set(yueLine, luaLine);
		}
	}

	return { luaToYue, yueToLua };
}

export function resolveYueLineFromLuaLine(map: LuaLineMap, luaLine: number): number | undefined {
	if (luaLine < 0 || luaLine >= map.luaToYue.length) {
		return undefined;
	}
	const direct = map.luaToYue[luaLine];
	if (direct !== undefined) {
		return direct;
	}
	for (let i = luaLine - 1; i >= 0; i--) {
		const prev = map.luaToYue[i];
		if (prev !== undefined) {
			return prev;
		}
	}
	for (let i = luaLine + 1; i < map.luaToYue.length; i++) {
		const next = map.luaToYue[i];
		if (next !== undefined) {
			return next;
		}
	}
	return undefined;
}

export function resolveLuaLineFromYueLine(map: LuaLineMap, yueLine: number): number | undefined {
	const direct = map.yueToLua.get(yueLine);
	if (direct !== undefined) {
		return direct;
	}
	for (let delta = 1; delta < map.luaToYue.length; delta++) {
		const prev = map.yueToLua.get(yueLine - delta);
		if (prev !== undefined) {
			return prev;
		}
		const next = map.yueToLua.get(yueLine + delta);
		if (next !== undefined) {
			return next;
		}
	}
	return undefined;
}

export function mapLuaRangeToYue(range: LspRange, lineMap: LuaLineMap): vscode.Range | null {
	const startLine = resolveYueLineFromLuaLine(lineMap, range.start.line);
	const endLine = resolveYueLineFromLuaLine(lineMap, range.end.line);
	if (startLine === undefined || endLine === undefined) {
		return null;
	}
	return new vscode.Range(
		new vscode.Position(startLine, range.start.character),
		new vscode.Position(endLine, range.end.character),
	);
}
