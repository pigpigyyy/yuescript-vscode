import * as vscode from "vscode";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { promises as fs } from "node:fs";
import {
	mapLuaRangeToYue,
	parseLuaLineMap,
	resolveLuaLineFromYueLine,
	type LuaLineMap,
} from "./mapping/line-map";
import {
	LuaLsClient,
	resolveLuaLsCommand,
	type LspCompletionItem,
	type LspDiagnostic,
	type LspInsertReplaceEdit,
	type LspTextEdit,
	type LspHover,
	type LspLocation,
	type LspLocationLink,
	type LspSignatureHelp,
	type LspSignatureInformation,
	type LspParameterInformation,
} from "./luals/client";

const LUA_SOURCE_COMMENT_PREFIX = "-- [yue]: ";
const COMPLETION_DUMMY = "___YUE_COMPLETION_DUMMY___";
const COMPLETION_DUMMY_CALL = "___DUMMY_CALL___";
const SIGNATURE_MARKER = "___YUE_SIGNATURE_MARKER___";
const YUE_KEYWORDS = [
	"and", "break", "class", "continue", "do", "else", "elseif", "export", "extends",
	"false", "for", "from", "global", "if", "import", "in", "local", "nil", "not",
	"or", "return", "switch", "then", "true", "unless", "when", "while", "with",
];

interface LuaDocState {
	luaUri: vscode.Uri;
	lineMap: LuaLineMap;
	luaLines: string[];
	lspVersion: number;
	enabled: boolean;
}

interface CompletionSourceState {
	uri: vscode.Uri;
	version: number;
	opened: boolean;
}

interface CompletionMeta {
	luaUri: string;
	lspItem: LspCompletionItem;
	cacheKey: string;
}

const COMPLETION_META_KEY = "__yue_luals_completion_meta__";
const completionResolveCache = new Map<string, CompletionMeta>();
const COMPLETION_CACHE_LIMIT = 2000;

interface YueReply {
	success: boolean;
	transpiledLuaCode?: string;
	realtimeTranspiledLuaCode?: string;
	messages: [string, string, number, number][];
	include?: string[];
	configDir?: string;
	build?: boolean;
	reserveLineNumber?: boolean;
	reserveComment?: boolean;
}

interface YueConfig {
	content: string;
	dir: string;
	module: string;
}

interface NearestYueConfig {
	content: string;
	dir: string;
}

interface RawSnippet {
	prefix: string | string[];
	body: string | string[];
	description?: string | string[];
}

interface RawSnippetFile {
	[name: string]: RawSnippet;
}

function getLuaPath(originalPath: string): string {
	return dirname(originalPath) + "/" + basename(originalPath, extname(originalPath)) + ".lua";
}

function isLuaLsEnabled(reply: YueReply): boolean {
	return !!(reply.build && reply.reserveLineNumber && reply.reserveComment);
}

function getSourceCommentPath(originalPath: string, configDir?: string, include?: string[]): string {
	if (!configDir) {
		return originalPath.replace(/\\/g, "/");
	}

	const configDirResolved = resolve(configDir);
	const originalPathResolved = resolve(originalPath);
	const relativePath = relative(configDirResolved, originalPathResolved);
	if (!relativePath.startsWith("..") && !relativePath.startsWith("/")) {
		return relativePath.replace(/\\/g, "/");
	}

	if (include && include.length > 0) {
		for (const inc of include) {
			const includePath = resolve(configDir, inc);
			const includeRelativePath = relative(includePath, originalPathResolved);
			if (!includeRelativePath.startsWith("..") && !includeRelativePath.startsWith("/")) {
				return includeRelativePath.replace(/\\/g, "/");
			}
		}
	}

	return originalPath.replace(/\\/g, "/");
}

function formatLuaText(document: vscode.TextDocument, reply: YueReply, luaCode: string): string {
	const sourcePath = getSourceCommentPath(document.uri.fsPath, reply.configDir, reply.include);
	return `${LUA_SOURCE_COMMENT_PREFIX}${sourcePath}\n${luaCode}`;
}

async function writeLuaBuildFile(document: vscode.TextDocument, reply: YueReply, luaCode: string) {
	const luaPath = getLuaPath(document.uri.fsPath);
	await fs.writeFile(luaPath, formatLuaText(document, reply, luaCode), "utf8");
}

function toSeverity(level: number | undefined): vscode.DiagnosticSeverity {
	switch (level) {
		case 1: return vscode.DiagnosticSeverity.Error;
		case 2: return vscode.DiagnosticSeverity.Warning;
		case 3: return vscode.DiagnosticSeverity.Information;
		case 4: return vscode.DiagnosticSeverity.Hint;
		default: return vscode.DiagnosticSeverity.Warning;
	}
}

function updateDiagnostics(diagnostics: vscode.DiagnosticCollection, document: vscode.TextDocument, messages: [string, string, number, number][]) {
	if (!(messages instanceof Array) || messages.length === 0) {
		diagnostics.set(document.uri, []);
		return;
	}

	const diags: vscode.Diagnostic[] = [];
	const globalMap = new Map<string, string[]>();
	const others: [string, string, number, number][] = [];

	for (const message of messages) {
		const [type, msg, line, column] = message;
		if (type === "global") {
			const key = `${line}:${column}`;
			if (!globalMap.has(key)) {
				globalMap.set(key, []);
			}
			globalMap.get(key)!.push(msg);
		} else {
			others.push(message);
		}
	}

	for (const [key, msgArr] of globalMap) {
		const [lineStr, colStr] = key.split(":");
		const line = Number(lineStr);
		const column = Number(colStr);
		const msg = `use of undeclared global variable: ${msgArr.join(", ")}`;
		const range = document.getWordRangeAtPosition(new vscode.Position(line - 1, column - 1));
		diags.push(new vscode.Diagnostic(
			range ?? new vscode.Range(line - 1, column - 1, line - 1, column),
			msg,
			vscode.DiagnosticSeverity.Warning,
		));
	}

	for (const message of others) {
		const [, msg, line, column] = message;
		const range = document.getWordRangeAtPosition(new vscode.Position(line - 1, column - 1));
		diags.push(new vscode.Diagnostic(
			range ?? new vscode.Range(line - 1, column - 1, line - 1, column),
			msg,
			vscode.DiagnosticSeverity.Error,
		));
	}

	diagnostics.set(document.uri, diags);
}

function lspKindToVscode(kind: number | undefined): vscode.CompletionItemKind | undefined {
	switch (kind) {
		case 1: return vscode.CompletionItemKind.Text;
		case 2: return vscode.CompletionItemKind.Method;
		case 3: return vscode.CompletionItemKind.Function;
		case 4: return vscode.CompletionItemKind.Constructor;
		case 5: return vscode.CompletionItemKind.Field;
		case 6: return vscode.CompletionItemKind.Variable;
		case 7: return vscode.CompletionItemKind.Class;
		case 8: return vscode.CompletionItemKind.Interface;
		case 9: return vscode.CompletionItemKind.Module;
		case 10: return vscode.CompletionItemKind.Property;
		case 11: return vscode.CompletionItemKind.Unit;
		case 12: return vscode.CompletionItemKind.Value;
		case 13: return vscode.CompletionItemKind.Enum;
		case 14: return vscode.CompletionItemKind.Keyword;
		case 15: return vscode.CompletionItemKind.Snippet;
		case 16: return vscode.CompletionItemKind.Color;
		case 17: return vscode.CompletionItemKind.File;
		case 18: return vscode.CompletionItemKind.Reference;
		case 19: return vscode.CompletionItemKind.Folder;
		case 20: return vscode.CompletionItemKind.EnumMember;
		case 21: return vscode.CompletionItemKind.Constant;
		case 22: return vscode.CompletionItemKind.Struct;
		case 23: return vscode.CompletionItemKind.Event;
		case 24: return vscode.CompletionItemKind.Operator;
		case 25: return vscode.CompletionItemKind.TypeParameter;
		default: return undefined;
	}
}

function isInsertReplaceEdit(edit: LspTextEdit | LspInsertReplaceEdit): edit is LspInsertReplaceEdit {
	return "insert" in edit && "replace" in edit;
}

function clampPosition(document: vscode.TextDocument, position: vscode.Position): vscode.Position {
	if (document.lineCount === 0) {
		return new vscode.Position(0, 0);
	}
	const line = Math.max(0, Math.min(position.line, document.lineCount - 1));
	const lineLength = document.lineAt(line).text.length;
	const character = Math.max(0, Math.min(position.character, lineLength));
	return new vscode.Position(line, character);
}

function clampRange(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
	const start = clampPosition(document, range.start);
	const end = clampPosition(document, range.end);
	return start.isAfter(end) ? new vscode.Range(end, start) : new vscode.Range(start, end);
}

function mapLuaEditToYueRange(edit: LspTextEdit, lineMap: LuaLineMap, document: vscode.TextDocument): vscode.Range | undefined {
	const mapped = mapLuaRangeToYue(edit.range, lineMap);
	if (!mapped) {
		return undefined;
	}
	return clampRange(document, mapped);
}

function readLuaTokenAt(line: string, column: number): string | undefined {
	if (line.length === 0) {
		return undefined;
	}
	const tokenChar = /[A-Za-z0-9_]/;
	const safeCol = Math.max(0, Math.min(column, line.length - 1));
	if (!tokenChar.test(line[safeCol] ?? "")) {
		return undefined;
	}

	let start = safeCol;
	while (start > 0 && tokenChar.test(line[start - 1] ?? "")) {
		start--;
	}
	let end = safeCol + 1;
	while (end < line.length && tokenChar.test(line[end] ?? "")) {
		end++;
	}

	const token = line.slice(start, end);
	return token.length > 0 ? token : undefined;
}

function findNearestTokenIndex(line: string, token: string, nearColumn: number): number | undefined {
	let cursor = 0;
	let bestIndex: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	while (cursor <= line.length - token.length) {
		const found = line.indexOf(token, cursor);
		if (found === -1) {
			break;
		}
		const distance = Math.abs(found - nearColumn);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = found;
		}
		cursor = found + 1;
	}
	return bestIndex;
}

function resolveLuaPositionFromYuePosition(
	document: vscode.TextDocument,
	state: LuaDocState,
	position: vscode.Position,
): { line: number; character: number } {
	const luaLine = resolveLuaLineFromYueLine(state.lineMap, position.line) ?? position.line;
	const safeLuaLine = Math.max(0, Math.min(luaLine, Math.max(0, state.luaLines.length - 1)));
	const luaLineText = state.luaLines[safeLuaLine] ?? "";

	const wordRange = document.getWordRangeAtPosition(position)
		?? (position.character > 0 ? document.getWordRangeAtPosition(position.translate(0, -1)) : undefined);
	if (wordRange && wordRange.start.line === position.line) {
		const token = document.getText(wordRange);
		const near = Math.max(0, position.character - wordRange.start.character);
		const mappedStart = findNearestTokenIndex(luaLineText, token, wordRange.start.character);
		if (mappedStart !== undefined) {
			const mappedChar = Math.min(luaLineText.length, mappedStart + near);
			return { line: safeLuaLine, character: mappedChar };
		}
	}

	const safeLuaCharacter = Math.max(0, Math.min(position.character, luaLineText.length));
	return { line: safeLuaLine, character: safeLuaCharacter };
}

function trimmedLineRange(document: vscode.TextDocument, lineNumber: number): vscode.Range {
	const line = document.lineAt(lineNumber);
	const text = line.text;
	let start = 0;
	let end = text.length;
	while (start < end && /\s/.test(text[start] ?? "")) {
		start++;
	}
	while (end > start && /\s/.test(text[end - 1] ?? "")) {
		end--;
	}
	if (start === end) {
		return new vscode.Range(lineNumber, 0, lineNumber, 0);
	}
	return new vscode.Range(lineNumber, start, lineNumber, end);
}

function mapLuaDiagnosticRangeToYue(
	document: vscode.TextDocument | undefined,
	state: LuaDocState,
	range: { start: { line: number; character: number }; end: { line: number; character: number } },
): vscode.Range | null {
	const mapped = mapLuaRangeToYue(range, state.lineMap);
	if (!mapped) {
		return null;
	}
	if (!document) {
		return mapped;
	}

	const yueLine = mapped.start.line;
	if (yueLine < 0 || yueLine >= document.lineCount) {
		return mapped;
	}

	const luaLineText = state.luaLines[range.start.line];
	const yueLineText = document.lineAt(yueLine).text;
	if (!luaLineText) {
		return trimmedLineRange(document, yueLine);
	}

	const token = readLuaTokenAt(luaLineText, range.start.character);
	if (!token) {
		return trimmedLineRange(document, yueLine);
	}

	const nearest = findNearestTokenIndex(yueLineText, token, range.start.character);
	if (nearest === undefined) {
		return trimmedLineRange(document, yueLine);
	}

	const endCol = Math.min(yueLineText.length, nearest + Math.max(token.length, 1));
	return new vscode.Range(yueLine, nearest, yueLine, endCol);
}

function toVscodeInsertText(text: string, insertTextFormat: number | undefined): string | vscode.SnippetString {
	if (insertTextFormat === 2) {
		return new vscode.SnippetString(text);
	}
	return text;
}

function toVscodeDocumentation(documentation: LspCompletionItem["documentation"]): vscode.MarkdownString | string | undefined {
	if (documentation === undefined) {
		return undefined;
	}
	if (typeof documentation === "string") {
		return documentation;
	}
	if (Array.isArray(documentation)) {
		const md = new vscode.MarkdownString();
		const chunks: string[] = [];
		for (const item of documentation) {
			if (typeof item === "string") {
				chunks.push(item);
			} else if (item.language && item.value) {
				chunks.push("```" + item.language + "\n" + item.value + "\n```");
			}
		}
		md.value = chunks.join("\n\n");
		return md.value.length > 0 ? md : undefined;
	}
	if (documentation.kind === "markdown") {
		return new vscode.MarkdownString(documentation.value ?? "");
	}
	return documentation.value;
}

function normalizeSnippetPrefixes(prefix: string | string[]): string[] {
	return Array.isArray(prefix) ? prefix : [prefix];
}

function normalizeSnippetBody(body: string | string[]): string {
	return Array.isArray(body) ? body.join("\n") : body;
}

function normalizeSnippetDescription(description?: string | string[]): string | undefined {
	if (description === undefined) {
		return undefined;
	}
	return Array.isArray(description) ? description.join(" ") : description;
}

async function loadSnippetItems(extensionPath: string, relativePath: string): Promise<vscode.CompletionItem[]> {
	const fullPath = `${extensionPath}/${relativePath}`;
	const raw = await fs.readFile(fullPath, "utf8");
	const parsed = JSON.parse(raw) as RawSnippetFile;
	const items: vscode.CompletionItem[] = [];
	for (const [name, snippet] of Object.entries(parsed)) {
		const body = normalizeSnippetBody(snippet.body);
		const description = normalizeSnippetDescription(snippet.description);
		for (const prefix of normalizeSnippetPrefixes(snippet.prefix)) {
			const item = new vscode.CompletionItem(prefix, vscode.CompletionItemKind.Snippet);
			item.insertText = new vscode.SnippetString(body);
			item.detail = `snippet: ${name}`;
			if (description) {
				item.documentation = description;
			}
			items.push(item);
		}
	}
	return items;
}

function extractDocumentationFromHover(hover: LspHover | undefined): LspCompletionItem["documentation"] | undefined {
	if (!hover?.contents) {
		return undefined;
	}
	return hover.contents;
}

function applyLspItemPresentation(target: vscode.CompletionItem, item: LspCompletionItem) {
	if (item.detail !== undefined) {
		target.detail = item.detail;
	}
	const docs = toVscodeDocumentation(item.documentation);
	if (docs !== undefined) {
		target.documentation = docs;
	}
}

async function resolveTopCompletionItems(client: LuaLsClient, items: LspCompletionItem[], maxCount: number): Promise<LspCompletionItem[]> {
	if (items.length === 0 || maxCount <= 0) {
		return items;
	}
	const resolved = items.slice();
	const candidates: number[] = [];
	for (let i = 0; i < resolved.length && candidates.length < maxCount; i++) {
		const item = resolved[i]!;
		if (item.insertTextFormat === 2 || item.kind === 15) {
			continue;
		}
		candidates.push(i);
	}
	const concurrency = 8;
	for (let i = 0; i < candidates.length; i += concurrency) {
		const chunk = candidates.slice(i, i + concurrency);
		await Promise.all(chunk.map(async (index) => {
			const current = resolved[index]!;
			try {
				resolved[index] = await client.resolveCompletionItem(current);
			} catch {
				// Ignore resolve failures and keep original item.
			}
		}));
	}
	return resolved;
}

function shouldResolveWithHoverFallback(item: LspCompletionItem): boolean {
	return item.documentation === undefined && (item.detail === undefined || item.detail.length === 0);
}

function completionProbeToken(item: LspCompletionItem): string | undefined {
	const preferred = typeof item.insertText === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.insertText)
		? item.insertText
		: undefined;
	if (preferred) {
		return preferred;
	}
	const labelMatch = item.label.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
	return labelMatch?.[1];
}

function findDummyMarker(luaText: string): { offset: number; marker: string } | undefined {
	const dummyOffset = luaText.indexOf(COMPLETION_DUMMY);
	if (dummyOffset >= 0) {
		return { offset: dummyOffset, marker: COMPLETION_DUMMY };
	}
	const callOffset = luaText.indexOf(COMPLETION_DUMMY_CALL);
	if (callOffset >= 0) {
		return { offset: callOffset, marker: COMPLETION_DUMMY_CALL };
	}
	return undefined;
}

async function fillCompletionDocsWithHover(
	client: LuaLsClient,
	state: CompletionSourceState,
	baseLuaText: string,
	marker: { offset: number; marker: string },
	items: LspCompletionItem[],
	maxCount: number,
) {
	let handled = 0;
	for (let i = 0; i < items.length && handled < maxCount; i++) {
		const item = items[i]!;
		if (!shouldResolveWithHoverFallback(item)) {
			continue;
		}
		const token = completionProbeToken(item);
		if (!token) {
			continue;
		}

		const probeText = `${baseLuaText.slice(0, marker.offset)}${token}${baseLuaText.slice(marker.offset + marker.marker.length)}`;
		const hoverPos = toLspPositionFromOffset(probeText, marker.offset + Math.min(1, Math.max(0, token.length - 1)));
		try {
			state.version += 1;
			client.didChange(state.uri.toString(), probeText, state.version);
			const hover = await client.hover(state.uri.toString(), hoverPos);
			const documentation = extractDocumentationFromHover(hover);
			if (documentation !== undefined) {
				item.documentation = documentation;
			}
		} catch {
			// Ignore hover fallback failures.
		}
		handled++;
	}

	state.version += 1;
	client.didChange(state.uri.toString(), baseLuaText, state.version);
}

function completionCacheKeyFromLspItem(item: LspCompletionItem): string {
	return [
		item.label,
		String(item.kind ?? ""),
		item.sortText ?? "",
		item.filterText ?? "",
		item.insertText ?? "",
	].join("\u0001");
}

function completionCacheKeyFromVscodeItem(item: vscode.CompletionItem): string {
	const insertText = typeof item.insertText === "string"
		? item.insertText
		: item.insertText instanceof vscode.SnippetString
			? item.insertText.value
			: "";
	return [
		item.label.toString(),
		String(item.kind ?? ""),
		item.sortText ?? "",
		item.filterText ?? "",
		insertText,
	].join("\u0001");
}

function putCompletionResolveCache(meta: CompletionMeta) {
	completionResolveCache.set(meta.cacheKey, meta);
	if (completionResolveCache.size <= COMPLETION_CACHE_LIMIT) {
		return;
	}
	const overflow = completionResolveCache.size - COMPLETION_CACHE_LIMIT;
	let removed = 0;
	for (const key of completionResolveCache.keys()) {
		completionResolveCache.delete(key);
		removed++;
		if (removed >= overflow) {
			break;
		}
	}
}

function toLspPositionFromOffset(text: string, offset: number): { line: number; character: number } {
	const safeOffset = Math.max(0, Math.min(offset, text.length));
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < safeOffset; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return {
		line,
		character: safeOffset - lineStart,
	};
}

function toOffsetFromPosition(text: string, position: vscode.Position): number {
	if (text.length === 0) {
		return 0;
	}
	let line = 0;
	let column = 0;
	for (let i = 0; i < text.length; i++) {
		if (line === position.line && column === position.character) {
			return i;
		}
		const ch = text.charCodeAt(i);
		if (ch === 10) {
			line++;
			column = 0;
		} else {
			column++;
		}
	}
	return text.length;
}

function buildYueCompletionSource(document: vscode.TextDocument, position: vscode.Position, linePrefix: string): string {
	const beforeCurrentLine = document.getText(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(position.line, 0)));
	const afterCurrentLine = position.line + 1 < document.lineCount
		? document.getText(new vscode.Range(new vscode.Position(position.line + 1, 0), new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)))
		: "";
	const leadingWhitespace = (document.lineAt(position.line).text.match(/^\s*/) ?? [""])[0];
	let dummyLine = `${leadingWhitespace}print(${COMPLETION_DUMMY})`;
	const completionChain = extractYueCompletionChain(linePrefix);
	if (completionChain) {
		dummyLine = `${leadingWhitespace}${completionChain}${COMPLETION_DUMMY_CALL}()`;
	}

	if (afterCurrentLine.length === 0) {
		return `${beforeCurrentLine}${dummyLine}\n`;
	}
	return `${beforeCurrentLine}${dummyLine}\n${afterCurrentLine}`;
}

function extractYueCompletionChain(linePrefix: string): string | undefined {
	const chainMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*[!?]?(?:\([^()\n]*\))?(?:(?:\.|\\)[A-Za-z_][A-Za-z0-9_]*[!?]?(?:\([^()\n]*\))?)*)(\.|\\|::|:)$/);
	if (!chainMatch) {
		return undefined;
	}
	const baseRaw = chainMatch[1] ?? "";
	const suffix = chainMatch[2] ?? "";
	if (baseRaw.length === 0) {
		return undefined;
	}
	// Normalize call chains for completion probing:
	// x\\func(123).abc("s", 1).def.  ->  x\\func().abc().def.
	const base = baseRaw.replace(/\([^()\n]*\)/g, "()");

	if (suffix === "." ) {
		return `${base}.`;
	}
	if (suffix === "\\" || suffix === "::" || suffix === ":") {
		return `${base}\\`;
	}
	return undefined;
}

function buildGlobalFallbackCompletionSource(document: vscode.TextDocument, position: vscode.Position): string {
	const beforeCurrentLine = document.getText(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(position.line, 0)));
	const afterCurrentLine = position.line + 1 < document.lineCount
		? document.getText(new vscode.Range(new vscode.Position(position.line + 1, 0), new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)))
		: "";
	const leadingWhitespace = (document.lineAt(position.line).text.match(/^\s*/) ?? [""])[0];
	const dummyLine = `${leadingWhitespace}print(_G.${COMPLETION_DUMMY})`;
	if (afterCurrentLine.length === 0) {
		return `${beforeCurrentLine}${dummyLine}\n`;
	}
	return `${beforeCurrentLine}${dummyLine}\n${afterCurrentLine}`;
}

function buildSignatureSource(document: vscode.TextDocument, position: vscode.Position): { source: string; markerOffset: number } {
	const full = document.getText();
	const offset = toOffsetFromPosition(full, position);
	const source = `${full.slice(0, offset)}${SIGNATURE_MARKER}${full.slice(offset)}`;
	return { source, markerOffset: offset };
}

function toSignatureDocumentation(value: string | { kind?: string; value: string } | undefined): string | vscode.MarkdownString | undefined {
	if (!value) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	if (value.kind === "markdown") {
		return new vscode.MarkdownString(value.value);
	}
	return value.value;
}

function toVscodeParameterInfo(parameter: LspParameterInformation, signatureLabel: string): vscode.ParameterInformation {
	let label: string | [number, number] = "";
	if (typeof parameter.label === "string") {
		label = parameter.label;
	} else {
		const start = Math.max(0, Math.min(parameter.label[0], signatureLabel.length));
		const end = Math.max(start, Math.min(parameter.label[1], signatureLabel.length));
		label = [start, end];
	}
	return new vscode.ParameterInformation(label, toSignatureDocumentation(parameter.documentation));
}

function toVscodeSignatureInfo(sig: LspSignatureInformation): vscode.SignatureInformation {
	const info = new vscode.SignatureInformation(sig.label, toSignatureDocumentation(sig.documentation));
	info.parameters = (sig.parameters ?? []).map((p) => toVscodeParameterInfo(p, sig.label));
	return info;
}

function toVscodeSignatureHelp(help: LspSignatureHelp): vscode.SignatureHelp {
	const result = new vscode.SignatureHelp();
	result.signatures = help.signatures.map(toVscodeSignatureInfo);
	result.activeSignature = Math.max(0, Math.min(help.activeSignature ?? 0, Math.max(0, result.signatures.length - 1)));
	const activeSignature = result.signatures[result.activeSignature];
	const maxParamIndex = Math.max(0, (activeSignature?.parameters?.length ?? 1) - 1);
	result.activeParameter = Math.max(0, Math.min(help.activeParameter ?? 0, maxParamIndex));
	return result;
}

function isLocationLink(value: LspLocation | LspLocationLink): value is LspLocationLink {
	return (value as LspLocationLink).targetUri !== undefined;
}

function toUriFromLocation(value: LspLocation | LspLocationLink): string {
	return isLocationLink(value) ? value.targetUri : value.uri;
}

function toRangeFromLocation(value: LspLocation | LspLocationLink): { range: { start: { line: number; character: number }; end: { line: number; character: number } } } {
	if (isLocationLink(value)) {
		return { range: value.targetSelectionRange ?? value.targetRange };
	}
	return { range: value.range };
}

function computeFallbackActiveParameter(document: vscode.TextDocument, position: vscode.Position): number | undefined {
	const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
	if (text.length === 0) {
		return undefined;
	}

	let roundDepth = 0;
	let squareDepth = 0;
	let curlyDepth = 0;
	let inSingle = false;
	let inDouble = false;
	let callStart = -1;

	for (let i = text.length - 1; i >= 0; i--) {
		const ch = text[i]!;
		const prev = i > 0 ? text[i - 1]! : "";
		if (inSingle) {
			if (ch === "'" && prev !== "\\") {
				inSingle = false;
			}
			continue;
		}
		if (inDouble) {
			if (ch === "\"" && prev !== "\\") {
				inDouble = false;
			}
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === "\"") {
			inDouble = true;
			continue;
		}

		if (ch === ")") {
			roundDepth++;
			continue;
		}
		if (ch === "]") {
			squareDepth++;
			continue;
		}
		if (ch === "}") {
			curlyDepth++;
			continue;
		}
		if (ch === "(") {
			if (roundDepth === 0 && squareDepth === 0 && curlyDepth === 0) {
				callStart = i;
				break;
			}
			roundDepth = Math.max(0, roundDepth - 1);
			continue;
		}
		if (ch === "[") {
			squareDepth = Math.max(0, squareDepth - 1);
			continue;
		}
		if (ch === "{") {
			curlyDepth = Math.max(0, curlyDepth - 1);
			continue;
		}
	}

	if (callStart < 0) {
		const lineText = document.lineAt(position.line).text.slice(0, position.character);
		const trimmed = lineText.trimStart();
		const firstWhitespace = trimmed.search(/\s/);
		if (firstWhitespace <= 0) {
			return undefined;
		}
		const argText = trimmed.slice(firstWhitespace).trimStart();
		if (argText.length === 0) {
			return 0;
		}
		return countTopLevelCommas(argText);
	}

	return countTopLevelCommas(text.slice(callStart + 1));
}

function countTopLevelCommas(text: string): number {
	let commas = 0;
	let roundDepth = 0;
	let squareDepth = 0;
	let curlyDepth = 0;
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		const prev = i > 0 ? text[i - 1]! : "";
		if (inSingle) {
			if (ch === "'" && prev !== "\\") {
				inSingle = false;
			}
			continue;
		}
		if (inDouble) {
			if (ch === "\"" && prev !== "\\") {
				inDouble = false;
			}
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === "\"") {
			inDouble = true;
			continue;
		}
		if (ch === "(") {
			roundDepth++;
			continue;
		}
		if (ch === "[") {
			squareDepth++;
			continue;
		}
		if (ch === "{") {
			curlyDepth++;
			continue;
		}
		if (ch === ")") {
			roundDepth = Math.max(0, roundDepth - 1);
			continue;
		}
		if (ch === "]") {
			squareDepth = Math.max(0, squareDepth - 1);
			continue;
		}
		if (ch === "}") {
			curlyDepth = Math.max(0, curlyDepth - 1);
			continue;
		}
		if (ch === "," && roundDepth === 0 && squareDepth === 0 && curlyDepth === 0) {
			commas++;
		}
	}

	return commas;
}

async function toYueLocationFromLuaTarget(
	luaUri: vscode.Uri,
	luaRange: { start: { line: number; character: number }; end: { line: number; character: number } },
	currentStates: Map<string, LuaDocState>,
): Promise<vscode.Location | undefined> {
	if (luaUri.scheme !== "file" || extname(luaUri.fsPath).toLowerCase() !== ".lua") {
		return undefined;
	}

	const yuePath = dirname(luaUri.fsPath) + "/" + basename(luaUri.fsPath, extname(luaUri.fsPath)) + ".yue";
	try {
		await fs.access(yuePath);
	} catch {
		return undefined;
	}

	const liveState = currentStates.get(yuePath);
	let lineMap: LuaLineMap | undefined = liveState?.lineMap;
	if (!lineMap) {
		try {
			const text = await fs.readFile(luaUri.fsPath, "utf8");
			lineMap = parseLuaLineMap(text);
		} catch {
			return undefined;
		}
	}

	const mapped = mapLuaRangeToYue(luaRange, lineMap);
	if (!mapped) {
		return undefined;
	}
	return new vscode.Location(vscode.Uri.file(yuePath), mapped);
}

function toCompletionItems(items: LspCompletionItem[], lineMap: LuaLineMap, document: vscode.TextDocument, position: vscode.Position, luaUri: string): vscode.CompletionItem[] {
	const result: vscode.CompletionItem[] = [];
	for (const item of items) {
		if (item.insertTextFormat === 2 || item.kind === 15) {
			continue;
		}

		const completion = new vscode.CompletionItem(item.label, lspKindToVscode(item.kind));
		applyLspItemPresentation(completion, item);
		if (item.textEdit) {
			if (isInsertReplaceEdit(item.textEdit)) {
				const inserting = mapLuaEditToYueRange({ range: item.textEdit.insert, newText: item.textEdit.newText }, lineMap, document);
				const replacing = mapLuaEditToYueRange({ range: item.textEdit.replace, newText: item.textEdit.newText }, lineMap, document);
				if (inserting && replacing) {
					completion.range = { inserting, replacing };
					completion.insertText = toVscodeInsertText(item.textEdit.newText, item.insertTextFormat);
				}
			} else {
				const mapped = mapLuaEditToYueRange(item.textEdit, lineMap, document);
				if (mapped) {
					completion.range = mapped;
					completion.insertText = toVscodeInsertText(item.textEdit.newText, item.insertTextFormat);
				}
			}
		}
		if (completion.insertText === undefined && item.insertText !== undefined) {
			completion.insertText = toVscodeInsertText(item.insertText, item.insertTextFormat);
		}
		if (completion.insertText === undefined) {
			completion.insertText = item.label;
		}
		if (item.sortText !== undefined) {
			completion.sortText = item.sortText;
		}
		if (item.filterText !== undefined) {
			completion.filterText = item.filterText;
		}
		if (item.preselect !== undefined) {
			completion.preselect = item.preselect;
		}
		if (item.commitCharacters !== undefined) {
			completion.commitCharacters = item.commitCharacters;
		}
		if (item.additionalTextEdits && item.additionalTextEdits.length > 0) {
			const additional = item.additionalTextEdits
				.map((edit) => {
					const mapped = mapLuaEditToYueRange(edit, lineMap, document);
					if (!mapped) {
						return undefined;
					}
					return new vscode.TextEdit(mapped, edit.newText);
				})
				.filter((edit): edit is vscode.TextEdit => !!edit);
			if (additional.length > 0) {
				completion.additionalTextEdits = additional;
			}
		}
		if (!completion.range) {
			const wordRange = document.getWordRangeAtPosition(position);
			if (wordRange) {
				completion.range = wordRange;
			}
		}
		const meta: CompletionMeta = {
			luaUri,
			lspItem: item,
			cacheKey: completionCacheKeyFromLspItem(item),
		};
		(completion as unknown as Record<string, unknown>)[COMPLETION_META_KEY] = meta;
		putCompletionResolveCache(meta);
		result.push(completion);
	}
	return result;
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
		},
	});

	const diagnostics = vscode.languages.createDiagnosticCollection("YueScript");
	const luaLsDiagnostics = vscode.languages.createDiagnosticCollection("YueScript LuaLS");
	context.subscriptions.push(diagnostics, luaLsDiagnostics);

	const luaStates = new Map<string, LuaDocState>();
	const luaToYue = new Map<string, vscode.Uri>();

	let luaClient: LuaLsClient | null = null;
	let luaClientStarting = false;
	let luaUnavailableWarningShown = false;
	let fallbackLuaSnippetItems: vscode.CompletionItem[] = [];
	try {
		const [standardLua, constants] = await Promise.all([
			loadSnippetItems(context.extensionPath, "snippets/standard-lua.json"),
			loadSnippetItems(context.extensionPath, "snippets/constants.json"),
		]);
		fallbackLuaSnippetItems = [...standardLua, ...constants];
	} catch (error) {
		console.error("Failed to load fallback Lua snippets:", error);
	}

	const handleLuaLsDiagnostics = (luaUri: string, lspDiagnostics: LspDiagnostic[]) => {
		const yueUri = luaToYue.get(luaUri);
		if (!yueUri) {
			return;
		}
		const state = luaStates.get(yueUri.fsPath);
		if (!state || state.luaUri.toString() !== luaUri) {
			return;
		}

		const document = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === yueUri.fsPath);
		const converted: vscode.Diagnostic[] = [];
		for (const diag of lspDiagnostics) {
			const range = mapLuaDiagnosticRangeToYue(document, state, diag.range);
			if (!range) {
				continue;
			}
			const result = new vscode.Diagnostic(range, diag.message, toSeverity(diag.severity));
			if (diag.code !== undefined) {
				result.code = diag.code;
			}
			result.source = "LuaLS";
			converted.push(result);
		}
		luaLsDiagnostics.set(yueUri, converted);
	};

	const ensureLuaClient = async (notifyOnFail: boolean) => {
		if (luaClient || luaClientStarting) {
			return;
		}
		luaClientStarting = true;
		try {
			const command = await resolveLuaLsCommand();
			const luaArgs = vscode.workspace.getConfiguration("yuescript").get<string[]>("luaLS.parameters") ?? [];
			const client = new LuaLsClient(command, luaArgs, {
				requestTimeoutMs: 15000,
				onExit: (reason) => {
					console.error("LuaLS exited:", reason);
					if (luaClient === client) {
						luaClient = null;
						luaToYue.clear();
						luaStates.clear();
						luaLsDiagnostics.clear();
					}
				},
			});
			client.onDiagnostics(handleLuaLsDiagnostics);
			const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? null;
			await client.initialize(rootUri);
			luaClient = client;
			luaUnavailableWarningShown = false;
		} catch (error) {
			console.error("Failed to start LuaLS:", error);
			luaClient = null;
			if (notifyOnFail && !luaUnavailableWarningShown) {
				luaUnavailableWarningShown = true;
				vscode.window.showWarningMessage("YueScript: LuaLS bridge unavailable. Check lua-language-server executable path.");
			}
		} finally {
			luaClientStarting = false;
		}
	};

	context.subscriptions.push({
		dispose() {
			if (luaClient) {
				luaClient.dispose();
				luaClient = null;
			}
		},
	});

	const closeLuaState = (document: vscode.TextDocument) => {
		const state = luaStates.get(document.uri.fsPath);
		if (state && luaClient) {
			luaClient.didClose(state.luaUri.toString());
			luaToYue.delete(state.luaUri.toString());
		}
		luaStates.delete(document.uri.fsPath);
		luaLsDiagnostics.delete(document.uri);
	};

	const syncLuaState = async (document: vscode.TextDocument, reply: YueReply) => {
		if (!luaClient || !reply.realtimeTranspiledLuaCode || !isLuaLsEnabled(reply)) {
			closeLuaState(document);
			return;
		}

		const luaUri = vscode.Uri.file(getLuaPath(document.uri.fsPath));
		const luaText = formatLuaText(document, reply, reply.realtimeTranspiledLuaCode);
		const lineMap = parseLuaLineMap(luaText);
		const prev = luaStates.get(document.uri.fsPath);
		const lspVersion = (prev?.lspVersion ?? 0) + 1;

		if (!prev || prev.luaUri.toString() !== luaUri.toString()) {
			if (prev) {
				luaClient.didClose(prev.luaUri.toString());
				luaToYue.delete(prev.luaUri.toString());
			}
			luaClient.didOpen(luaUri.toString(), luaText, lspVersion);
		} else {
			luaClient.didChange(luaUri.toString(), luaText, lspVersion);
		}

		luaToYue.set(luaUri.toString(), document.uri);
		luaStates.set(document.uri.fsPath, {
			luaUri,
			lineMap,
			luaLines: luaText.split("\n"),
			lspVersion,
			enabled: true,
		});
	};

	const refreshDocumentState = async (document: vscode.TextDocument, isSaveEvent: boolean, laxCheck?: boolean) => {
		await ensureLuaClient(false);
		const reply = await textChangeCallback({
			document,
			yueProcess,
			isSaveEvent,
			realtimeLua: true,
			laxCheck: laxCheck ?? false,
		});
		if (!reply) {
			return null;
		}
		if (!laxCheck) {
			updateDiagnostics(diagnostics, document, reply.messages);
		}
		await syncLuaState(document, reply);
		return reply;
	};

	const yueConfigWatcher = vscode.workspace.createFileSystemWatcher("**/yueconfig.yue");
	context.subscriptions.push(yueConfigWatcher);
	context.subscriptions.push(yueConfigWatcher.onDidCreate((uri) => invalidateYueConfigCaches(uri.fsPath)));
	context.subscriptions.push(yueConfigWatcher.onDidChange((uri) => invalidateYueConfigCaches(uri.fsPath)));
	context.subscriptions.push(yueConfigWatcher.onDidDelete((uri) => invalidateYueConfigCaches(uri.fsPath)));

	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
		if (document.languageId === "yuescript") {
			closeLuaState(document);
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (document) => {
		if (document.languageId === "yuescript") {
			await refreshDocumentState(document, false);
		}
	}));

	for (const document of vscode.workspace.textDocuments) {
		if (document.languageId === "yuescript") {
			void refreshDocumentState(document, false);
		}
	}

	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
		{ language: "yuescript" },
		{
			async provideCompletionItems(document, position, _token, completionContext) {
				await ensureLuaClient(false);
				if (!luaClient) {
					return undefined;
				}
				const client = luaClient;

				const linePrefix = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

				try {
					const requestCompletionFromSource = async (source: string): Promise<vscode.CompletionList | undefined> => {
						const completionReply = await textChangeCallback({
							document,
							yueProcess,
							isSaveEvent: false,
							realtimeLua: true,
							laxCheck: true,
							sourceCode: source,
						});
						if (!completionReply?.realtimeTranspiledLuaCode) {
							return undefined;
						}
						const completionLuaText = formatLuaText(document, completionReply, completionReply.realtimeTranspiledLuaCode);
						const dummyMarker = findDummyMarker(completionLuaText);
						if (!dummyMarker) {
							return undefined;
						}

						const lineMap = parseLuaLineMap(completionLuaText);
						const completionPos = toLspPositionFromOffset(completionLuaText, dummyMarker.offset);
						const completionState: CompletionSourceState = {
							uri: vscode.Uri.file(`${getLuaPath(document.uri.fsPath)}.__yue_completion__.lua`),
							version: 1,
							opened: true,
						};
						client.didOpen(completionState.uri.toString(), completionLuaText, completionState.version);
						const completion = await client.completion(
							completionState.uri.toString(),
							completionPos,
							completionContext.triggerCharacter,
						);
						const resolvedItems = await resolveTopCompletionItems(client, completion.items, Math.min(30, completion.items.length));
						await fillCompletionDocsWithHover(
							client,
							completionState,
							completionLuaText,
							dummyMarker,
							resolvedItems,
							8,
						);
						try {
							return new vscode.CompletionList(
								toCompletionItems(resolvedItems, lineMap, document, position, completionState.uri.toString()),
								completion.isIncomplete,
							);
						} finally {
							client.didClose(completionState.uri.toString());
						}
					};

					const first = await requestCompletionFromSource(buildYueCompletionSource(document, position, linePrefix));
					if (first && first.items.length > 0) {
						return first;
					}

					const globalFallback = await requestCompletionFromSource(buildGlobalFallbackCompletionSource(document, position));
					if (globalFallback && globalFallback.items.length > 0) {
						return globalFallback;
					}

					const keywordItems = YUE_KEYWORDS.map((word) => {
						const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
						item.insertText = word;
						return item;
					});
					if (keywordItems.length > 0) {
						return new vscode.CompletionList(keywordItems, false);
					}

					await refreshDocumentState(document, false);
					const state = luaStates.get(document.uri.fsPath);
					if (!state || !state.enabled) {
						return undefined;
					}
					const luaLine = resolveLuaLineFromYueLine(state.lineMap, position.line) ?? position.line;
					const safeLuaLine = Math.max(0, Math.min(luaLine, Math.max(0, state.luaLines.length - 1)));
					const luaLineText = state.luaLines[safeLuaLine] ?? "";
					const safeLuaCharacter = Math.max(0, Math.min(position.character, luaLineText.length));
					const completion = await luaClient.completion(
						state.luaUri.toString(),
						{ line: safeLuaLine, character: safeLuaCharacter },
						completionContext.triggerCharacter,
					);
					const resolvedItems = await resolveTopCompletionItems(luaClient, completion.items, Math.min(30, completion.items.length));
					return new vscode.CompletionList(
						toCompletionItems(resolvedItems, state.lineMap, document, position, state.luaUri.toString()),
						completion.isIncomplete,
					);
				} catch (error) {
					console.error("LuaLS completion failed:", error);
					return undefined;
				}
			},
			async resolveCompletionItem(item) {
				await ensureLuaClient(false);
				if (!luaClient) {
					return item;
				}
				const metaFromItem = (item as unknown as Record<string, unknown>)[COMPLETION_META_KEY] as CompletionMeta | undefined;
				const meta = metaFromItem?.lspItem
					? metaFromItem
					: completionResolveCache.get(completionCacheKeyFromVscodeItem(item));
				if (!meta?.lspItem) {
					return item;
				}
				try {
					const resolved = await luaClient.resolveCompletionItem(meta.lspItem);
					applyLspItemPresentation(item, resolved);
				} catch (error) {
					console.error("LuaLS completion resolve failed:", error);
				}
				return item;
			},
		},
		".",
		":",
		"\\",
	));

	context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(
		{ language: "yuescript" },
		{
			async provideSignatureHelp(document, position, _token, context) {
				await ensureLuaClient(false);
				if (!luaClient) {
					return undefined;
				}
				const client = luaClient;
				try {
					const { source } = buildSignatureSource(document, position);
					const reply = await textChangeCallback({
						document,
						yueProcess,
						isSaveEvent: false,
						realtimeLua: true,
						laxCheck: true,
						sourceCode: source,
					});
					if (!reply?.realtimeTranspiledLuaCode) {
						return undefined;
					}

					const luaText = formatLuaText(document, reply, reply.realtimeTranspiledLuaCode);
					const markerOffset = luaText.indexOf(SIGNATURE_MARKER);
					if (markerOffset < 0) {
						return undefined;
					}
					const signaturePos = toLspPositionFromOffset(luaText, markerOffset);

					const state: CompletionSourceState = {
						uri: vscode.Uri.file(`${getLuaPath(document.uri.fsPath)}.__yue_signature__.lua`),
						version: 1,
						opened: true,
					};
					client.didOpen(state.uri.toString(), luaText, state.version);
					const lspHelp = await client.signatureHelp(
						state.uri.toString(),
						signaturePos,
						context.triggerCharacter,
					);
					if (!lspHelp || !Array.isArray(lspHelp.signatures) || lspHelp.signatures.length === 0) {
						return undefined;
					}
					const fallbackActiveParameter = computeFallbackActiveParameter(document, position);
					if (fallbackActiveParameter !== undefined) {
						lspHelp.activeParameter = fallbackActiveParameter;
					}
					return toVscodeSignatureHelp(lspHelp);
				} catch (error) {
					console.error("LuaLS signatureHelp failed:", error);
					return undefined;
				} finally {
					const uri = vscode.Uri.file(`${getLuaPath(document.uri.fsPath)}.__yue_signature__.lua`).toString();
					try {
						luaClient?.didClose(uri);
					} catch {
						// ignore
					}
				}
			},
		},
		"(",
		",",
		" ",
	));

	context.subscriptions.push(vscode.languages.registerHoverProvider(
		{ language: "yuescript" },
		{
			async provideHover(document, position) {
				await ensureLuaClient(false);
				if (!luaClient) {
					return undefined;
				}
				let state = luaStates.get(document.uri.fsPath);
				if (!state || !state.enabled) {
					await refreshDocumentState(document, false, true);
					state = luaStates.get(document.uri.fsPath);
				}
				if (!state || !state.enabled) {
					return undefined;
				}

				const luaPos = resolveLuaPositionFromYuePosition(document, state, position);

				try {
					const hover = await luaClient.hover(state.luaUri.toString(), luaPos);
					if (!hover?.contents) {
						return undefined;
					}
					const docs = toVscodeDocumentation(hover.contents as LspCompletionItem["documentation"]);
					if (!docs) {
						return undefined;
					}
					return new vscode.Hover(docs, document.getWordRangeAtPosition(position));
				} catch (error) {
					console.error("LuaLS hover failed:", error);
					return undefined;
				}
			},
		},
	));

	context.subscriptions.push(vscode.languages.registerDefinitionProvider(
		{ language: "yuescript" },
		{
			async provideDefinition(document, position) {
				await ensureLuaClient(false);
				if (!luaClient) {
					return undefined;
				}
				let state = luaStates.get(document.uri.fsPath);
				if (!state || !state.enabled) {
					await refreshDocumentState(document, false, true);
					state = luaStates.get(document.uri.fsPath);
				}
				if (!state || !state.enabled) {
					return undefined;
				}

				const luaPos = resolveLuaPositionFromYuePosition(document, state, position);

				try {
					const targets = await luaClient.definition(state.luaUri.toString(), luaPos);
					if (!targets || targets.length === 0) {
						return undefined;
					}
					const mapped: vscode.Location[] = [];
					for (const target of targets) {
						const uri = vscode.Uri.parse(toUriFromLocation(target));
						const luaRange = toRangeFromLocation(target).range;
						const yueLocation = await toYueLocationFromLuaTarget(uri, luaRange, luaStates);
						if (yueLocation) {
							mapped.push(yueLocation);
							continue;
						}
						mapped.push(new vscode.Location(uri, new vscode.Range(
							new vscode.Position(luaRange.start.line, luaRange.start.character),
							new vscode.Position(luaRange.end.line, luaRange.end.character),
						)));
					}
					return mapped;
				} catch (error) {
					console.error("LuaLS definition failed:", error);
					return undefined;
				}
			},
		},
	));

	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
		{ language: "yuescript" },
		{
			provideCompletionItems() {
				if (luaClient) {
					return undefined;
				}
				if (fallbackLuaSnippetItems.length === 0) {
					return undefined;
				}
				return new vscode.CompletionList(fallbackLuaSnippetItems, false);
			},
		},
	));

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (document.languageId !== "yuescript") {
			return;
		}
		if (basename(document.uri.fsPath).toLowerCase() === "yueconfig.yue") {
			invalidateYueConfigCaches(document.uri.fsPath);
		}

		const reply = await textChangeCallback({
			document,
			yueProcess,
			isSaveEvent: true,
			realtimeLua: true,
		});
		if (!reply) {
			return;
		}
		updateDiagnostics(diagnostics, document, reply.messages);

		if (basename(document.uri.fsPath).toLowerCase() !== "yueconfig.yue") {
			await syncLuaState(document, reply);
		}

		if (reply.build && reply.transpiledLuaCode) {
			if (basename(document.uri.fsPath).toLowerCase() === "yueconfig.yue") {
				return;
			}
			try {
				await writeLuaBuildFile(document, reply, reply.transpiledLuaCode);
			} catch (error) {
				console.error(`Failed to write Lua file to ${getLuaPath(document.uri.fsPath)}:`, error);
			}
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
		if (event.contentChanges.length === 0 || event.document.languageId !== "yuescript") {
			return;
		}
		await refreshDocumentState(event.document, false);
	}));

	await ensureLuaClient(true);
}

export function deactivate() {}

let yueTaskQueue: Promise<void> = Promise.resolve();
let yueStdoutBuffer = "";
const nearestConfigLookupCache = new Map<string, NearestYueConfig | null>();
const configContentCache = new Map<string, string>();

function enqueueYueTask<T>(task: () => Promise<T>): Promise<T> {
	const run = yueTaskQueue.then(task, task);
	yueTaskQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function invalidateYueConfigCaches(configPath?: string) {
	if (configPath) {
		configContentCache.delete(configPath);
	}
	nearestConfigLookupCache.clear();
}

function readYueReplyLine(yueProcess: ChildProcessByStdio<Writable, Readable, null>): Promise<string> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			yueProcess.stdout.off("data", onData);
			yueProcess.stdout.off("error", onError);
			yueProcess.stdout.off("close", onClose);
		};

		const tryConsumeLine = () => {
			const newlineIndex = yueStdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) {
				return false;
			}
			const line = yueStdoutBuffer.slice(0, newlineIndex);
			yueStdoutBuffer = yueStdoutBuffer.slice(newlineIndex + 1);
			cleanup();
			resolve(line);
			return true;
		};

		const onData = (chunk: Buffer | string) => {
			yueStdoutBuffer += chunk instanceof Buffer ? chunk.toString("utf8") : chunk;
			tryConsumeLine();
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onClose = () => {
			cleanup();
			reject(new Error("Yue process stdout closed before a complete reply was received."));
		};

		if (tryConsumeLine()) {
			return;
		}

		yueProcess.stdout.on("data", onData);
		yueProcess.stdout.once("error", onError);
		yueProcess.stdout.once("close", onClose);
	});
}

async function findNearestYueConfig(documentUri: vscode.Uri): Promise<NearestYueConfig | undefined> {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
	const workspaceRoot = workspaceFolder?.uri.fsPath;
	const startDir = dirname(documentUri.fsPath);
	const cacheKey = workspaceRoot ? `${workspaceRoot}::${startDir}` : startDir;

	if (nearestConfigLookupCache.has(cacheKey)) {
		const cached = nearestConfigLookupCache.get(cacheKey);
		if (!cached) {
			return undefined;
		}
		return { content: cached.content, dir: cached.dir };
	}

	let currentDir = startDir;
	while (true) {
		const configPath = resolve(currentDir, "yueconfig.yue");
		let content = configContentCache.get(configPath);
		if (content === undefined) {
			try {
				content = await fs.readFile(configPath, "utf8");
				configContentCache.set(configPath, content);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT") {
					console.error(`Failed to read yueconfig.yue at ${configPath}:`, error);
				}
			}
		}
		if (content !== undefined) {
			const config = { content, dir: currentDir };
			nearestConfigLookupCache.set(cacheKey, config);
			return config;
		}

		if ((workspaceRoot && currentDir === workspaceRoot) || dirname(currentDir) === currentDir) {
			break;
		}
		currentDir = dirname(currentDir);
	}

	nearestConfigLookupCache.set(cacheKey, null);
	return undefined;
}

async function textChangeCallback({
	document,
	yueProcess,
	isSaveEvent,
	realtimeLua,
	laxCheck,
	sourceCode,
}: {
	document: vscode.TextDocument;
	yueProcess: ChildProcessByStdio<Writable, Readable, null>;
	isSaveEvent: boolean;
	realtimeLua?: boolean;
	laxCheck?: boolean;
	sourceCode?: string;
}): Promise<YueReply | null> {
	return enqueueYueTask(async () => {
		const nearestConfig = await findNearestYueConfig(document.uri);

		const dataToSend: { sourceCode: string; config?: YueConfig; isSaveEvent?: boolean; realtimeLua?: boolean; laxCheck?: boolean } = {
			sourceCode: sourceCode ?? document.getText().trimEnd(),
		};
		if (isSaveEvent) {
			dataToSend.isSaveEvent = true;
		}
		if (realtimeLua) {
			dataToSend.realtimeLua = true;
		}
		if (laxCheck) {
			dataToSend.laxCheck = true;
		}
		if (nearestConfig) {
			dataToSend.config = {
				content: nearestConfig.content,
				dir: nearestConfig.dir,
				module: relative(nearestConfig.dir, document.fileName),
			};
		}

		return await new Promise<YueReply>((resolve, reject) => {
			const callback = () => {
				process.nextTick(async () => {
					let replyText: string;
					try {
						replyText = await readYueReplyLine(yueProcess);
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
						return;
					}

					try {
						const reply = JSON.parse(replyText) as YueReply;
						resolve(reply);
					} catch (err) {
						reject(new Error(`${String(err)} -> ${replyText}`));
					}
				});
			};

			if (!yueProcess.stdin.write(JSON.stringify(dataToSend) + "\n")) {
				yueProcess.stdin.once("drain", callback);
			} else {
				callback();
			}
		});
	});
}
