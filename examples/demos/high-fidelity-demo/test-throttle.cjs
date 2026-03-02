const { spawn } = require("node:child_process");

const server = spawn("pnpm", ["exec", "tsx", "src/run-mcp.ts"], {
	cwd: process.cwd(),
	stdio: ["pipe", "pipe", "inherit"],
});

server.stdout.on("data", (data) => {
	const output = data.toString();
	console.log("[From Server]:", output);
	if (output.includes("NMP_THROTTLED")) {
		console.log("✅ Throttler works!");
		process.exit(0);
	}
});

server.stderr.on("data", (_data) => {
	// console.error('[Server Err]:', data.toString());
});

const send = (payload) => {
	server.stdin.write(`${JSON.stringify(payload)}\n`);
};

// 1. Send multiple bad requests to trigger the rate limiter (Threshold of 5)
for (let i = 0; i < 6; i++) {
	send({
		jsonrpc: "2.0",
		id: i,
		method: "tools/call",
		params: {
			name: "nmp_audit_sandbox",
			arguments: { payload: "BAD_PAYLOAD_NO_BOUNDARIES" },
		},
	});
}

setTimeout(() => {
	process.exit(1);
}, 3000);
