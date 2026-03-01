import { spawn } from "child_process";

const server = spawn("pnpm", ["exec", "tsx", "src/run-mcp.ts"], {
	cwd: process.cwd(),
	stdio: ["pipe", "pipe", "inherit"],
	shell: true,
});

server.stdout.on("data", (data) => {
	const output = data.toString();
	console.log("[From Server]:", output);
	if (output.includes("NMP_THROTTLED")) {
		console.log("✅ Throttler works!");
		process.exit(0);
	}
});

const send = (payload) => {
	server.stdin.write(JSON.stringify(payload) + "\n");
};

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
	console.log("Timeout without hitting throttler.");
	process.exit(1);
}, 4000);
