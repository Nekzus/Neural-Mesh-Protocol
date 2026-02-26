import { z } from "zod";
import { NmpMcpBridge, NmpServer } from "../src/index.js";

/**
 * Example 3: Legacy JSON-RPC MCP Bridge (stdio simulation)
 * Shows how NmpMcpBridge allows legacy MCP Clients connecting via IDEs (like Cursor/Claude Desktop)
 * to communicate with an advanced NMP node over standard IO/JSON-RPC.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Legacy MCP Bridge (stdio) ===");
	console.log(
		"In a real environment, this script runs via `stdio` spawned by an MCP Client.",
	);
	console.log("For this example, we mock the JSON-RPC input:\n");

	// 1. Core NMP Server implementation
	const nmpServer = new NmpServer({
		name: "FilesystemMcpBridge",
		version: "1.0.0",
	});

	nmpServer.tool(
		"read_file",
		"Read contents of a local file",
		{ path: z.string() },
		async ({ path }) => {
			return {
				content: [{ type: "text", text: `Mocked content of ${path}` }],
			};
		},
	);

	// 2. Wrap the server in the generic MCP Bridge
	const bridge = new NmpMcpBridge(nmpServer);

	// 3. Mock incoming MCP payload (Standard JSON-RPC 2.0)
	const incomingCallCommand = {
		jsonrpc: "2.0",
		id: "req_xyz987",
		method: "tools/call",
		params: {
			name: "read_file",
			arguments: {
				path: "/home/user/document.txt",
			},
		},
	};

	console.log("Incoming MCP RPC Payload:");
	console.log(JSON.stringify(incomingCallCommand, null, 2));

	// 4. Handle RPC and route natively
	console.log("\nBridging and Executing via NMP...");
	const response = await bridge.handleJsonRpcRequest(incomingCallCommand);

	console.log("\nOutgoing MCP Compatible Response:");
	console.log(JSON.stringify(response, null, 2));
}

main().catch(console.error);
