import * as vscode from "vscode";
import { spawn, spawnSync, type ExecFileException, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { highlightSyntax, type StyledRange } from "./syntaxHighlighter";
import { registerSemanticHighlighter } from "./semanticHighlighter";

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
		disposables.push(outputChannel);

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
		const body: string = `${message}`.replaceAll(
			"\n",
			(" ".repeat(prefix.length)) + "\n",
		);

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

const disposables: vscode.Disposable[] = [];

let diagnostics: vscode.DiagnosticCollection | undefined = undefined;
export function activate(context: vscode.ExtensionContext): void {
	logger ??= Logger.new(context);
	logger.verbsoe("YueScript extension activated!");

	editorCallback(vscode.window.activeTextEditor);
	disposables.push(vscode.window.onDidChangeActiveTextEditor(editorCallback));

	const textChangeDisposable: vscode.Disposable = vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
		const activeEditor = vscode.window.activeTextEditor;
		if ((!activeEditor) || (event.document !== activeEditor.document)) {
			return;
		}
		editorCallback(activeEditor);
	});
	context.subscriptions.push(textChangeDisposable);
	disposables.push(textChangeDisposable);

	diagnostics = vscode.languages.createDiagnosticCollection("YueScript");
	context.subscriptions.push(diagnostics);
	disposables.push(diagnostics);

	disposables.push(registerSemanticHighlighter());
}

export function deactivate(): void {
	const count: number = disposables.length;
	for (let i = 0; i < count; i++) {
		disposables.pop()?.dispose();
	}

	logger?.verbsoe("YueScript extension deactivated!");
}

////////////////////////////////////////////////////////////////////////////////

function runCommand(
	command: string,
	args: string[],
	input: string,
	callback: (code: number, stdout: string, stderr: string) => void,
): ChildProcessWithoutNullStreams {
	const child: ChildProcessWithoutNullStreams = spawn("stdbuf", ["-i0", "-o0", "-e0", command, ...args], {
		shell: false,
		stdio: ["pipe", "pipe", "pipe"],
		// serialization: "json",
	});

	let stdout: string = "";
	let stderr: string = "";

	child.stdout.on("data", (chunk: any): void => {
		if (!chunk) {
			return;
		}

		logger?.debug(`New stdout chunk: "${chunk}"`);

		stdout += String(chunk);
	});

	child.stderr.on("data", (chunk: any): void => {
		if (!chunk) {
			return;
		}

		logger?.debug(`New stderr chunk: "${chunk}"`);

		stderr += String(chunk);
	});

	child.on("close", (code: number | null, _signal: NodeJS.Signals | null): void => {
		callback(code ?? 0, stdout, stderr);
	});

	/*child.stdin.write(input);
	child.stdin.end();*/

	return child;
}

async function writeToCommandStdin(child: ChildProcessWithoutNullStreams, input: string) {
	await new Promise<any[]>((resolve, reject) => {
		if (child.stdin.writableLength === 0) {
			resolve([]);
			return;
		}

		child.stdin.once("drain", (...args: any[]) => {
			resolve(args);
		});
	});

	//logger?.debug(input);
	child.stdin.write(JSON.stringify(input) + "\n\n");
}

const checkYueScript: string = `\
import "yue"
const json = do
	local success, result = nil, nil

	if success, result := pcall(require, "cjson")
		result
	elseif success, result := pcall(require, "json")
		result
	else
		error("Could not find a JSON-module for YueScript! Please install one.")


const writeOutput = (message) ->
	assert(type(message) == "string")

	io.stdout::write(message) -- , "\\n")
	io.stdout::flush()
	--- An explicit 'return' is needed here because calling the 'flush()'-method
	--- returns the file-handle it was called on (i.e. 'io.stdout').
	return


const transpile = (sourceCode) ->
	const input = io.read("*a")

	if input == nil
		return os.exit(0)
	elseif type(input) != "string"
		return os.exit(1)

	const success, astOrError, transpiledLuaCode = yue.check(sourceCode)

	assert(type(success) == "boolean")
	assert(type(astOrError) == "table")
	assert(type(transpiledLuaCode) == (success and "string" or "nil"))

	const result = json.encode(success and {
		:success,
		ast: astOrError,
		:transpiledLuaCode
	} or {
		:success,
		error: astOrError
	})::gsub("[%z-\\031]+", "")

	assert(type(result) == "string")
	-- assert(result::match("[^%z-\\031]+()") == (#result + 1))

	result


const main = () ->
	--os.execute("stty raw icanon")
	io.stderr::write("Test")
	io.stderr::flush()
	const input = io.stdin::read("*l")
	os.execute("sleep 1")

	if input == nil
		os.exit(0)
	elseif type(input) != "string"
		os.exit(1)
	elseif input != ""
		writeOutput(transpile(json.decode(input)))


while true
	main()
`;

let temp: ChildProcessWithoutNullStreams | null = null;

async function editorCallback(editor: vscode.TextEditor | undefined): Promise<void> {
	if (!editor) {
		logger?.debug("No editor is currently active.");
		return;
	}

	if (editor.document.languageId !== "yuescript") {
		return;
	}

	const uri: vscode.Uri = editor.document.uri;
	const sourceCode: string = editor.document.getText();
	//logger?.debug(`sourceCode[${sourceCode.length}] = ${sourceCode}`);
	//const decorations: StyledRange[] = await highlightSyntax(sourceCode);

	if (temp) {
		writeToCommandStdin(temp, sourceCode.trimEnd());
		return;
	}

	temp = runCommand("yue", ["-e", checkYueScript], sourceCode.trimEnd(), (code: number, stdout: string, stderr: string): void => {
		if (code === 0) {
			diagnostics?.clear();
			return;
		}

		logger?.debug(`stdout = "${stdout}"`);
		return;

		const parts: [string, string, string] = stdout.split(":", 3) as any;
		const line: number = Math.max(1, Number(parts[0]));
		const column: number = Math.max(1, Number(parts[1]));
		const message: string = parts[2];

		logger?.debug(`Error at line ${line}, column ${column}: ${message}`);
		diagnostics?.set(uri, [new vscode.Diagnostic(
			new vscode.Range(line - 1, column - 1, line - 1, column),
			message,
			vscode.DiagnosticSeverity.Error,
		)]);
	});

	// TODO: Apply decorations (syntax highlighting)
	// Example: editor.setDecorations(someDecorationType, decorations);
}
