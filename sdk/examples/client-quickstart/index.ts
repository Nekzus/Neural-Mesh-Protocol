import { NmpClient, CallToolRequest } from "../../src/index.js";

/**
 * NMP Client Quickstart
 *
 * Demonstrates how a simple Agent connects to a Mesh/Server and
 * requests to execute logic locally on the origin server.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Client Quickstart ===");

	// 1. Initialize Client Agent
	const client = new NmpClient({
		name: "nmp-quickstart-client",
		version: "1.0.0",
	});

	try {
		// 2. Discover / Connect to the remote compute node
		console.log("Connecting to target Server...");
		await client.connect();
		console.log(
			"Connection established. Target Name:",
			client.getServerInfo()?.name,
		);

		// 3. Dispatch the payload execution
		console.log("Dispatching execution logic (calculate_sum)...");

		const request: CallToolRequest = {
			name: "calculate_sum",
			arguments: { a: 40, b: 2 },
		};

		const result = await client.callTool(request);
		console.log("\n[Origin Execution Output]:");
		console.log(result.content[0].text);
	} catch (error) {
		console.error("Execution Failed:", error);
	}
}

main().catch(console.error);
