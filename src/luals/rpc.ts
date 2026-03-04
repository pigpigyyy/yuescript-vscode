import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timeout: NodeJS.Timeout;
}

interface RpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

interface RpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export class JsonRpcProcess {
	private readonly process: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly notifications = new Map<string, ((params: unknown) => void)[]>();
	private readonly onExit: ((reason: Error) => void) | undefined;
	private readonly requestTimeoutMs: number;
	private nextId = 1;
	private buffer = Buffer.alloc(0);
	private exited = false;

	constructor(command: string, args: string[], options?: {
		cwd?: string;
		requestTimeoutMs?: number;
		onExit?: (reason: Error) => void;
	}) {
		this.onExit = options?.onExit;
		this.requestTimeoutMs = Math.max(1000, options?.requestTimeoutMs ?? 15000);
		this.process = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: options?.cwd,
		});

		this.process.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
		this.process.stderr.on("data", (chunk: Buffer) => {
			console.error(`[LuaLS] ${chunk.toString("utf8")}`);
		});
		this.process.on("exit", (code, signal) => {
			this.exited = true;
			const reason = new Error(`LuaLS exited (code=${String(code)}, signal=${String(signal)})`);
			for (const [, p] of this.pending) {
				clearTimeout(p.timeout);
				p.reject(reason);
			}
			this.pending.clear();
			if (this.onExit) {
				this.onExit(reason);
			}
		});
	}

	public onNotification(method: string, handler: (params: unknown) => void) {
		if (!this.notifications.has(method)) {
			this.notifications.set(method, []);
		}
		this.notifications.get(method)!.push(handler);
	}

	public notify(method: string, params?: unknown) {
		const payload = {
			jsonrpc: "2.0",
			method,
			params,
		};
		this.write(payload);
	}

	public request(method: string, params?: unknown): Promise<unknown> {
		if (this.exited) {
			return Promise.reject(new Error("LuaLS process already exited."));
		}
		const id = this.nextId++;
		const payload = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`LuaLS request timeout: ${method}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
			this.write(payload);
		});
	}

	public dispose() {
		this.process.stdin.end();
		if (!this.process.killed) {
			this.process.kill();
		}
	}

	private write(payload: unknown) {
		const content = Buffer.from(JSON.stringify(payload), "utf8");
		const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, "utf8");
		this.process.stdin.write(Buffer.concat([header, content]));
	}

	private onData(chunk: Buffer) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) {
				return;
			}

			const headerText = this.buffer.subarray(0, headerEnd).toString("utf8");
			const lengthLine = headerText
				.split("\r\n")
				.find((line) => line.toLowerCase().startsWith("content-length:"));
			if (!lengthLine) {
				this.buffer = this.buffer.subarray(headerEnd + 4);
				continue;
			}

			const contentLength = Number(lengthLine.split(":")[1]?.trim() ?? "0");
			const totalLength = headerEnd + 4 + contentLength;
			if (this.buffer.length < totalLength) {
				return;
			}

			const body = this.buffer.subarray(headerEnd + 4, totalLength).toString("utf8");
			this.buffer = this.buffer.subarray(totalLength);
			this.dispatch(body);
		}
	}

	private dispatch(body: string) {
		let message: unknown;
		try {
			message = JSON.parse(body);
		} catch (error) {
			console.error("Failed to parse LuaLS message:", error, body);
			return;
		}

		if (typeof message !== "object" || message === null) {
			return;
		}

		if ("id" in message && ("result" in message || "error" in message)) {
			const response = message as RpcResponse;
			const pending = this.pending.get(response.id);
			if (!pending) {
				return;
			}
			this.pending.delete(response.id);
			clearTimeout(pending.timeout);
			if (response.error) {
				pending.reject(new Error(response.error.message));
				return;
			}
			pending.resolve(response.result);
			return;
		}

		if ("method" in message) {
			const notif = message as RpcNotification;
			const handlers = this.notifications.get(notif.method);
			if (!handlers) {
				return;
			}
			for (const handler of handlers) {
				handler(notif.params);
			}
		}
	}
}
