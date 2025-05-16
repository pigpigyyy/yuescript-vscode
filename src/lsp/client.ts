import { spawn } from "node:child_process";
import Stream from "node:stream";

function log(strings: TemplateStringsArray, ...args: any[]) {
	let combined: string = strings[0]!;
	for (let i = 0; i < args.length; i++) {
		combined += JSON.stringify(args[i]) ?? args[i].toString();
		combined += strings[i + 1];
	}
	console.log(`\x1b[1;35m[\x1b[31mCLIENT\x1b[35m]\x1b[0m ` + combined);
}

const home = Bun.env["HOME"] ?? Bun.env["USERPROFILE"];

if (typeof(home) !== "string") {
	throw new Error("Failed to get user home path!");
}

const server = spawn(
	home + "/.luarocks/bin/yue",
	["-e", "./src/lsp/server.yue"],
	{
		stdio: ["pipe", "pipe", "inherit"],
		env: {
			"LUA_PATH": [
				"./?.lua",
				"/usr/local/share/lua/5.4/?.lua",
				"/usr/local/share/lua/5.4/?/init.lua",
				"/usr/local/lib/lua/5.4/?.lua",
				"/usr/local/lib/lua/5.4/?/init.lua",
				"/usr/share/lua/5.4/?.lua",
				"/usr/share/lua/5.4/?/init.lua",
				home + "/.luarocks/share/lua/5.4/?.lua",
				home + "/.luarocks/share/lua/5.4/?/init.lua",
			].join(";"),
			"LUA_CPATH": [
				"./?.so",
				"/usr/local/lib/lua/5.4/?.so",
				"/usr/lib/x86_64-linux-gnu/lua/5.4/?.so",
				"/usr/lib/lua/5.4/?.so",
				"/usr/local/lib/lua/5.4/loadall.so",
				home + "/.luarocks/lib/lua/5.4/?.so",
			].join(";"),
		},
	}
);

const encoder: TextEncoder = new TextEncoder();
const decoder: TextDecoder = new TextDecoder();

type Json = (
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [P in string]: Json }
);

function sendMessage(id: Json | undefined, msg: Record<string, Json>): void {
	if (id !== undefined) {
		msg["id"] ??= id;
	}
	msg["jsonrpc"] ??= "2.0";

	const json: string = JSON.stringify(msg);
	const header: string = `Content-Length: ${json.length}\r\n\r\n${json}\r\n`;
	const content: Uint8Array = encoder.encode(header);

	log`sendMessage(id=${id}, msg=${msg});`;

	server.stdin!.write(content);
}

function parseContentLength(headers: string[]): number {
	const matches: string[] | undefined = headers
		.find(h => h.startsWith("Content-Length: "))
		?.split(":");
	if (matches === undefined) {
		return 0;
	}

	const first: string | undefined = matches[1];
	if (first === undefined) {
		return 0;
	}

	return parseInt(first.trim());
}

async function readMessages(stream: Stream.Readable/* ReadableStream<Uint8Array> */) {
	/* const reader = stream.getReader(); */
	let buffer: string = "";

	let value: string;
	while (null !== (value = stream.read())) {
		/* const { value, done } = await reader.read();
		//log`{ value: ${decoder.decode(value)}, done: ${done} }`;
		if (done) {
			break;
		} */

		buffer += value/* decoder.decode(value, {
			stream: true,
		}) */;

		while (true) {
			const headerEnd: number = buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) {
				//log`headerEnd=${headerEnd} < 0`;
				break;
			}

			const headers: string[] = buffer.slice(0, headerEnd).split("\r\n");
			const contentLength: number = parseContentLength(headers);

			const totalLength: number = headerEnd + 4 + contentLength;
			if (buffer.length < totalLength) {
				//log`buffer.length=${buffer.length} < totalLength=${totalLength}`;
				break;
			}

			const body: string = buffer.slice(headerEnd + 4, totalLength);
			const message: Json = JSON.parse(body);
			log`message=${message}`;
			buffer = buffer.slice(totalLength);
		}
	}
}

readMessages(server.stdout!);

sendMessage(1, {
	method: "initialize",
	params: {
		processId: process.pid,
		rootUri: null,
		capabilities: {},
	},
});

setTimeout(() => {
	sendMessage(1, {
		method: "initialized",
		params: {},
	});
}, 100);

setTimeout(() => {
	log`Timeout reached, shutting down...`;

	sendMessage(2, {
		method: "shutdown",
		params: null,
	});

	sendMessage(3, {
		jsonrpc: "2.0",
		method: "exit",
	});

	server.stdin!.end();
}, 2000);
