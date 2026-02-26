import { NmpServer } from "../src/index.js";

/**
 * Example 4: Exposing Dynamic Resources
 * Demonstrates how an NmpServer can expose structured dynamic resources,
 * mimicking the modelcontextprotocol/sdk's resource capability.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Dynamic Resources & Prompts ===");

	const server = new NmpServer({ name: "DocumentServer", version: "1.0.0" });

	// 1. Registering Resources
	server.resource(
		"Syslog Stream",
		"file:///var/log/syslog",
		"A live stream of the agent's internal kernel operations",
		"text/plain",
	);

	server.resource(
		"Telemetry Graph",
		"nmp://data/graph-live",
		"Real-time JSON mapping of distributed sensor data",
		"application/json",
	);

	console.log(
		"\n[Server Info] Registered the following static/dynamic resources:",
	);

	// In a full implementation, `server.listResources()` would be available.
	// Here we simulate the internal mapping access for demonstration.
	const internalResources: Map<string, any> = (server as any).resources;

	for (const [uri, resource] of internalResources.entries()) {
		console.log(`- [${resource.name}] ${uri} (${resource.mimeType})`);
		console.log(`  Description: ${resource.description}`);
	}

	// 2. Mock Prompts Configuration placeholder
	console.log("\n[Server Info] Future Parity: LLM Prompts Configuration.");
	console.log(
		"Just like MCP, NMP will natively serve `.prompt()` objects tailored for Agentic Frontends.",
	);
}

main().catch(console.error);
