import * as vscode from "vscode";
import { dirname, join } from "node:path";
import { promises as fs } from "node:fs";
import { JsonRpcProcess } from "./rpc";
import type { LspPosition, LspRange } from "../mapping/line-map";

const LUALS_EXTENSION_IDS = ["LuaLS.vscode-lua", "sumneko.lua"] as const;

export interface LspDiagnostic {
	range: LspRange;
	severity?: number;
	code?: string | number;
	message: string;
	source?: string;
}

export interface LspTextEdit {
	range: LspRange;
	newText: string;
}

export interface LspInsertReplaceEdit {
	insert: LspRange;
	replace: LspRange;
	newText: string;
}

export interface LspCompletionItem {
	label: string;
	kind?: number;
	data?: unknown;
	detail?: string;
	documentation?: string | { kind?: string; value: string } | Array<string | { language: string; value: string }>;
	insertText?: string;
	insertTextFormat?: 1 | 2;
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	commitCharacters?: string[];
	textEdit?: LspTextEdit | LspInsertReplaceEdit;
	additionalTextEdits?: LspTextEdit[];
}

export interface LspCompletionResult {
	items: LspCompletionItem[];
	isIncomplete: boolean;
}

export interface LspHover {
	contents?: string | { kind?: string; value: string } | Array<string | { language: string; value: string }>;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

export interface LspLocationLink {
	targetUri: string;
	targetRange: LspRange;
	targetSelectionRange: LspRange;
	originSelectionRange?: LspRange;
}

export interface LspParameterInformation {
	label: string | [number, number];
	documentation?: string | { kind?: string; value: string };
}

export interface LspSignatureInformation {
	label: string;
	documentation?: string | { kind?: string; value: string };
	parameters?: LspParameterInformation[];
}

export interface LspSignatureHelp {
	signatures: LspSignatureInformation[];
	activeSignature?: number;
	activeParameter?: number;
}

export class LuaLsClient {
	private readonly rpc: JsonRpcProcess;
	private initialized = false;

	constructor(command: string, args: string[], options?: {
		requestTimeoutMs?: number;
		onExit?: (reason: Error) => void;
	}) {
		const rpcOptions: {
			cwd: string;
			requestTimeoutMs?: number;
			onExit?: (reason: Error) => void;
		} = { cwd: dirname(command) };
		if (options?.requestTimeoutMs !== undefined) {
			rpcOptions.requestTimeoutMs = options.requestTimeoutMs;
		}
		if (options?.onExit) {
			rpcOptions.onExit = options.onExit;
		}
		this.rpc = new JsonRpcProcess(command, args, rpcOptions);
	}

	public onDiagnostics(handler: (uri: string, diagnostics: LspDiagnostic[]) => void) {
		this.rpc.onNotification("textDocument/publishDiagnostics", (params) => {
			const p = params as { uri: string; diagnostics: LspDiagnostic[] };
			handler(p.uri, p.diagnostics ?? []);
		});
	}

	public async initialize(rootUri: string | null) {
		if (this.initialized) {
			return;
		}

		await this.rpc.request("initialize", {
			processId: process.pid,
			rootUri,
			capabilities: {
				textDocument: {
					completion: {
						completionItem: {
							documentationFormat: ["markdown", "plaintext"],
							snippetSupport: false,
							resolveSupport: {
								properties: ["detail", "documentation", "additionalTextEdits"],
							},
						},
					},
					signatureHelp: {
						signatureInformation: {
							documentationFormat: ["markdown", "plaintext"],
						},
					},
				},
			},
			initializationOptions: {
				changeConfiguration: false,
			},
		});

		this.rpc.notify("initialized", {});
		this.initialized = true;
	}

	public didOpen(uri: string, text: string, version: number) {
		this.rpc.notify("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "lua",
				version,
				text,
			},
		});
	}

	public didChange(uri: string, text: string, version: number) {
		this.rpc.notify("textDocument/didChange", {
			textDocument: { uri, version },
			contentChanges: [{ text }],
		});
	}

	public didClose(uri: string) {
		this.rpc.notify("textDocument/didClose", {
			textDocument: { uri },
		});
	}

	public async completion(uri: string, position: LspPosition, triggerCharacter?: string): Promise<LspCompletionResult> {
		const response = await this.rpc.request("textDocument/completion", {
			textDocument: { uri },
			position,
			context: {
				triggerKind: triggerCharacter ? 2 : 1,
				triggerCharacter,
			},
		});

		if (!response) {
			return { items: [], isIncomplete: false };
		}
		if (Array.isArray(response)) {
			return { items: response as LspCompletionItem[], isIncomplete: false };
		}
		const list = response as { items?: LspCompletionItem[]; isIncomplete?: boolean };
		return { items: list.items ?? [], isIncomplete: !!list.isIncomplete };
	}

	public async resolveCompletionItem(item: LspCompletionItem): Promise<LspCompletionItem> {
		const response = await this.rpc.request("completionItem/resolve", item);
		return (response as LspCompletionItem | null) ?? item;
	}

	public async hover(uri: string, position: LspPosition): Promise<LspHover | undefined> {
		const response = await this.rpc.request("textDocument/hover", {
			textDocument: { uri },
			position,
		});
		return (response as LspHover | null) ?? undefined;
	}

	public async definition(uri: string, position: LspPosition): Promise<LspLocation[] | LspLocationLink[] | undefined> {
		const response = await this.rpc.request("textDocument/definition", {
			textDocument: { uri },
			position,
		});
		if (!response) {
			return undefined;
		}
		if (Array.isArray(response)) {
			return response as LspLocation[] | LspLocationLink[];
		}
		return [response as LspLocation];
	}

	public async signatureHelp(uri: string, position: LspPosition, triggerCharacter?: string): Promise<LspSignatureHelp | undefined> {
		const response = await this.rpc.request("textDocument/signatureHelp", {
			textDocument: { uri },
			position,
			context: {
				triggerKind: triggerCharacter ? 2 : 1,
				triggerCharacter,
				isRetrigger: !!triggerCharacter,
			},
		});
		return (response as LspSignatureHelp | null) ?? undefined;
	}

	public dispose() {
		this.rpc.dispose();
	}
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
	for (const p of paths) {
		try {
			await fs.access(p);
			return p;
		} catch {
			continue;
		}
	}
	return undefined;
}

export async function resolveLuaLsCommand(): Promise<string> {
	const cfg = vscode.workspace.getConfiguration("yuescript");
	const configured = cfg.get<string>("luaLS.executablePath");
	if (configured && configured.trim() !== "") {
		return configured;
	}

	for (const extensionId of LUALS_EXTENSION_IDS) {
		const ext = vscode.extensions.getExtension(extensionId);
		if (!ext) {
			continue;
		}

		const base = ext.extensionPath;
		const candidates: string[] = [];
		if (process.platform === "darwin") {
			candidates.push(join(base, "server", "bin", "lua-language-server"));
			candidates.push(join(base, "server", "bin-macOS", "lua-language-server"));
		} else if (process.platform === "linux") {
			candidates.push(join(base, "server", "bin", "lua-language-server"));
			candidates.push(join(base, "server", "bin-Linux", "lua-language-server"));
		} else if (process.platform === "win32") {
			candidates.push(join(base, "server", "bin", "lua-language-server.exe"));
			candidates.push(join(base, "server", "bin-Windows", "lua-language-server.exe"));
		}

		const existing = await firstExistingPath(candidates);
		if (existing) {
			if (process.platform !== "win32") {
				await fs.chmod(existing, 0o755).catch(() => undefined);
			}
			return existing;
		}
	}

	return "lua-language-server";
}
