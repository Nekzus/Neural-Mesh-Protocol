import { z } from "zod";
import { NmpServer } from "../src/index.js";

/**
 * Example 2: Advanced Zod Tooling & Error Handling
 * Shows how NmpServer enforces strict input validations mirroring MCP behavior.
 */

async function main() {
	console.log("=== Neural Mesh Protocol: Advanced Zod Validations ===");

	const server = new NmpServer({ name: "DataProcessingHub", version: "2.1.0" });

	// Register a complex pipeline tool
	server.tool(
		"process_telemetry",
		"Processes a batch of raw telemetry mapping objects",
		{
			batchId: z.string().uuid(),
			records: z.array(
				z.object({
					timestamp: z.string().datetime(),
					value: z.number(),
					tags: z.array(z.string()).default([]),
				}),
			),
			strictMode: z.boolean().default(false),
		},
		async ({ batchId, records, strictMode }) => {
			console.log(`\n[Execution Sandbox] Processing Batch UUID: ${batchId}`);
			console.log(`[Execution Sandbox] Strict Mode: ${strictMode}`);
			console.log(`[Execution Sandbox] Ingress Records: ${records.length}`);

			return {
				content: [
					{
						type: "text",
						text: `Successfully processed telemetry batch ${batchId}`,
					},
				],
			};
		},
	);

	console.log("\n--- Valid Request Execution ---");
	const validRequest = await server.callTool({
		name: "process_telemetry",
		arguments: {
			batchId: "123e4567-e89b-12d3-a456-426614174000",
			records: [{ timestamp: new Date().toISOString(), value: 404.2 }],
		},
	});
	console.log(validRequest);

	console.log("\n--- Invalid Request Execution (Zod Enforcement) ---");
	// Purposely passing an invalid UUID and missing required fields in records
	const invalidRequest = await server.callTool({
		name: "process_telemetry",
		arguments: {
			batchId: "not-a-uuid",
			records: [{ value: "should-be-number" }],
		},
	});

	console.log("Expected Validation Error Triggered:");
	console.log(JSON.stringify(invalidRequest, null, 2));
}

main().catch(console.error);
