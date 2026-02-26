import { z } from "zod";
import { NmpClient, NmpServer } from "../src/index.js";

/**
 * Example 1: Mesh Discovery & Local Execution
 * Demonstrates a local Agent discovering tools on a NMP Server node and executing them.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Discovery Example ===");

	// 1. Initialize the Server Node exposing capabilities
	const serverNode = new NmpServer(
		{ name: "GlobalWeatherNode", version: "1.0.0" },
		{ capabilities: { read_io: true } },
	);

	// Register a Tool with Zod strictly typed inputs
	serverNode.tool(
		"get_sensor_data",
		"Retrieves pseudo-weather attributes from a specific sector",
		{
			sector: z.string().describe("Quadrant or Area name to scan"),
			depth: z.number().min(0).max(100).optional().describe("Scanning depth"),
		},
		async ({ sector, depth }) => {
			console.log(
				`[Server] Incoming Execution -> Sector: ${sector}, Depth: ${depth ?? "Surface"}`,
			);
			const data = JSON.stringify({
				temp: 24.5,
				humidity: 60,
				status: "stable",
			});
			return {
				content: [{ type: "text", text: data }],
			};
		},
	);

	// 2. Initialize the Client Node (Agent)
	const agentNode = new NmpClient({
		name: "WeatherAnalyzerAgent",
		version: "1.0.0",
	});

	console.log("\n[Agent] Connecting to NMP Mesh...");
	await agentNode.connect(); // Emulates DHT Bootstrapping

	console.log(
		"\n[Agent] Discovering Remote Tools (Logic-on-Origin injection targets):",
	);
	const discoveredTools = serverNode.listTools(); // Normally discovered via DHT
	console.table(
		discoveredTools.map((t) => ({ Name: t.name, Description: t.description })),
	);

	console.log("\n[Agent] Executing `get_sensor_data`...");

	// In NMP, rather than pulling the data, the client pushes the logic.
	// For this TS simulated example, we call it synchronously.
	const result = await serverNode.callTool({
		name: "get_sensor_data",
		arguments: { sector: "Alpha-7", depth: 42 },
	});

	console.log("\n[Agent] Raw Result from Execution Sandbox:");
	console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
