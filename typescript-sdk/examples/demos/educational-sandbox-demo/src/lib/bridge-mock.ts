import type { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * BridgeMock simulates the NMP P2P / gRPC transport layer.
 * It takes care of routing the Logic-on-Origin capsule to the Data Node.
 */
export async function server_node_exec(
	auditId: string,
	wasmPayload: Buffer,
): Promise<any> {
	// In a real NMP, this would go through libp2p gRPC streams.
	// For the demo, we dynamically import the server logic and call its handler.

	// We simulate the context passed to the server tool
	const server_logic = await import("../server-node.js");

	// In a real gRPC call, the server's 'extra' context for a tool
	// is populated by the transport layer with the decapsulated WASM payload.

	// We need to access the server instance to call the tool
	// Since server-node.ts exports nothing currently but runs the server,
	// we use a more direct approach: we simulate the server's tool execution.

	const { GuardianAST } = await import("./guardian.js");
	const { WasiSandbox } = await import("./sandbox.js");

	console.log(
		`[NMP-BRIDGE] Routing Encrypted Capsule to Strategic-Data-Node-Alpha...`,
	);

	// Server Side Simulation
	if (!GuardianAST.validate(wasmPayload)) {
		throw new Error("SECURITY_VIOLATION: Guardian AST rejected the payload.");
	}

	const { result, receipt } = await WasiSandbox.execute(wasmPayload, {
		auditId,
	});

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					status: "SUCCESS",
					results: result,
					verification: {
						zk_receipt: receipt,
						journal: receipt.journal,
					},
				}),
			},
		],
		isError: false,
	};
}
