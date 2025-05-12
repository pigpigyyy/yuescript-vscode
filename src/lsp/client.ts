//console.log(Bun.env["PATH"]?.replaceAll(":", "\n"))

const home = Bun.env["HOME"];

if (typeof(home) !== "string") {
	throw new Error("...");
}

const server: Bun.Subprocess<"pipe", "pipe", "inherit"> = Bun.spawn(
	[home + "/.luarocks/bin/yue", "-e", "./src/lsp/server.yue"],
	{
		stdin: "pipe",
		stdout: "pipe",
		stderr: "inherit",
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
	
	console.log(`sendMessage(id=${id}, msg=${json});`);

	server.stdin!.write(content);
}

function parseContentLength(headers: string[]): number {
	const matches: string[] | undefined = headers.find(h => h
		//.toLowerCase()
		.startsWith("Content-Length: ")
	)?.split(":");
	if (matches === undefined) {
		return 0;
	}

	const first: string | undefined = matches[1];
	if (first === undefined) {
		return 0;
	}

	return parseInt(first.trim());
}

async function readMessages(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	let buffer: string = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			console.log(`{ value: ${value}, done: ${done} }`);
			break;
		}

		buffer += decoder.decode(value, {
			stream: true,
		});

		while (true) {
			const headerEnd: number = buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) {
				console.log(`headerEnd=${headerEnd} < 0`);
				break;
			}

			const headers: string[] = buffer.slice(0, headerEnd).split("\r\n");
			const contentLength: number = parseContentLength(headers);

			const totalLength: number = headerEnd + 4 + contentLength;
			if (buffer.length < totalLength) {
				console.log(`buffer.length=${buffer.length} < totalLength=${totalLength}`);
				break;
			}

			const body: string = buffer.slice(headerEnd + 4, totalLength);
			const message: Json = JSON.parse(body);
			console.log("Received message: ", message);
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
