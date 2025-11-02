import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";

////////////////////////////////////////////////////////////////////////////////

type UTCDateRecord = Readonly<{
	milliseconds: string;
	second:       string;
	minute:       string;
	hour:         string;
	day:          string;
	month:        string;
	year:         string;
}>;

function getUTCDateRecord(date?: Date | string | number | null | undefined): UTCDateRecord {
	date = new Date(date ?? Date.now());

	const zeroPad = (value: number, count: number): string => {
		return String(value).padStart(count, "0")
	};

	return {
		milliseconds: zeroPad(date.getUTCMilliseconds(), 0),
		second:       zeroPad(date.getUTCSeconds(),      2),
		minute:       zeroPad(date.getUTCMinutes(),      2),
		hour:         zeroPad(date.getUTCHours(),        2),
		day:          zeroPad(date.getUTCDate(),         2),
		month:        zeroPad(date.getUTCMonth() + 1,    2),
		year:         zeroPad(date.getUTCFullYear(),     4),
	} as const;
}

enum LogLevel {
	CRITICAL = "CRITICAL",
	ERROR    = "ERROR",
	WARNING  = "WARNING",
	MESSAGE  = "MESSAGE",
	INFO     = "INFO",
	VERBOSE  = "VERBOSE",
	DEBUG    = "DEBUG",
}

class Logger {
	readonly #outputChannel: vscode.OutputChannel;
	#isDisposed: boolean;

	private constructor(
		outputChannel: vscode.OutputChannel,
		isDisposed: boolean,
	) {
		this.#outputChannel = outputChannel;
		this.#isDisposed = isDisposed;
	}

	public static new(context: vscode.ExtensionContext): Logger {
		const outputChannel: vscode.OutputChannel = vscode
			.window
			.createOutputChannel("YueScript");
		outputChannel.show();
		context.subscriptions.push(outputChannel);

		return new this(outputChannel, false);
	}

	public dispose(): void {
		if (this.#isDisposed) {
			return;
		}

		this.#outputChannel.dispose();
	}

	public [Symbol.dispose](): void {
		return this.dispose();
	}

	#writeMessage(message: any, level: LogLevel): void {
		const dateString: string = ((): string => {
			const { day, month, hour, minute } = getUTCDateRecord();
			return `${day}/${month} ${hour}:${minute}`;
		})();

		const prefix: string = `[YueScript] [${dateString}] [${level}] `;
		const body: string = `${message}`/*.replaceAll(
			"\n",
			"\n" + (" ".repeat(prefix.length)),
		)*/;

		this.#outputChannel.appendLine(prefix + body);
	}

	public critical(message: any): void { return this.#writeMessage(message, LogLevel.CRITICAL); }
	public error   (message: any): void { return this.#writeMessage(message, LogLevel.ERROR); }
	public warning (message: any): void { return this.#writeMessage(message, LogLevel.WARNING); }
	public message (message: any): void { return this.#writeMessage(message, LogLevel.MESSAGE); }
	public info    (message: any): void { return this.#writeMessage(message, LogLevel.INFO); }
	public verbsoe (message: any): void { return this.#writeMessage(message, LogLevel.VERBOSE); }
	public debug   (message: any): void { return this.#writeMessage(message, LogLevel.DEBUG); }
}

let logger: Logger | undefined = undefined;

////////////////////////////////////////////////////////////////////////////////

export async function activate(context: vscode.ExtensionContext) {
	logger ??= Logger.new(context);
	logger.verbsoe("YueScript extension activated!");

	const yueProcess: ChildProcessWithoutNullStreams = spawn("yue", ["-e", context.extensionPath + "/src/server.yue"], {
		stdio: "pipe",
		//serialization: "json",
	});

	yueProcess.stdout.on("data", (data) => {
		logger?.debug(`stdout: (${typeof data})"${String(data)}"`);
	});

	yueProcess.stderr.on("data", (data) => {
		logger?.debug(`stderr: (${typeof data})"${String(data)}"`);
	});

	context.subscriptions.push({
		dispose() {
			yueProcess.stdin?.end();
			if (!yueProcess.killed) {
				yueProcess.kill();
			}
		}
	});

	const f = () => {
		const cb = (...args: any[]) => {
			logger?.debug(`stdin callback called with args=[${args}]`);
			setTimeout(f, 1000);
		};

		if (!yueProcess.stdin.write(JSON.stringify({
			sourceCode: "Test"
		}) + "\r\n")) {
			yueProcess.stdin.once("drain", cb);
		} else {
			process.nextTick(cb);
		}
	};
	f();
}

export function deactivate() {}
