import { NmpServer } from "@neural-mesh/sdk";
import { z } from "zod";

/**
 * NMP Server Quickstart
 *
 * Demonstrates how to rapidly bring up a Logic-on-Origin Server exposing
 * simple computation directly into the Neural Mesh Protocol.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Server Quickstart ===");

	// 1. Initialize Server
	const server = new NmpServer({
		name: "nmp-quickstart-server",
		version: "1.0.0",
	});

	console.log("Server instance created successfully.");

	// 2. Expose a simple capability using Zod validation
	server.tool(
		"calculate_sum",
		"Adds two numbers together without fetching them locally",
		{
			a: z.number().describe("First operand"),
			b: z.number().describe("Second operand"),
		},
		async ({ a, b }: { a: number; b: number }) => {
			console.log(`[Quickstart] Internal Execution triggered for: ${a} + ${b}`);
			return {
				content: [{ type: "text", text: String(a + b) }],
			};
		},
	);

	console.log(
		"Tool 'calculate_sum' registered. Server ready for Agent requests.",
	);

	// In a real environment, this connects to the P2P Mesh or stdio bridge.
	// e.g. await server.listen(new StdIoServerTransport());
}

main().catch(console.error);
