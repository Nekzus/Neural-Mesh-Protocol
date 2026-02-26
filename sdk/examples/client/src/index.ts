import { NmpClient, CallToolRequest } from "@neural-mesh/sdk";

/**
 * NMP Advanced Client Example
 *
 * Demonstrates an Agent dispatching complex logic payloads, handling
 * Zod validation failures correctly, and discovering capabilities dynamically.
 */

async function main() {
    console.log("=== Neural Mesh Protocol: Advanced Client ===");

    const client = new NmpClient({ name: "EnterpriseAgent", version: "1.0.0" });

    // 1. Connect & Discover
    await client.connect();
    console.log(
        `\nConnected to ${client.getServerInfo()?.name}. Fetching Graph Capabilities...`,
    );

    const tools = await client.discoverTools();
    console.log("Discovered APIs available for execution:");
    console.table(tools);

    // 2. Dispatch an invalid payload to test Server-Side Zod Rejection
    console.log(
        "\nDispatching INVALID telemetry to test Zero-Trust Sandboxing...",
    );
    const invalidRequest: CallToolRequest = {
        name: "process_telemetry",
        arguments: {
            batchId: "not-a-real-uuid", // Will trigger Zod error on the server
            records: [{ timestamp: "2026-02-25" }],
        },
    };

    const invalidResult = await client.callTool(invalidRequest);

    if (invalidResult.isError) {
        console.warn("\n[Client] Server gracefully rejected the execution:");
        console.warn(invalidResult.content[0].text);
    }

    // 3. Dispatch a valid payload
    console.log("\nDispatching VALID telemetry payload...");
    const validRequest: CallToolRequest = {
        name: "process_telemetry",
        arguments: {
            batchId: "550e8400-e29b-41d4-a716-446655440000",
            records: [
                {
                    timestamp: new Date().toISOString(),
                    value: 99.9,
                    tags: ["critical"],
                },
            ],
        },
    };

    const validResult = await client.callTool(validRequest);
    console.log("\n[Origin Execution Output]:");
    console.log(validResult.content[0].text);
}

main().catch(console.error);
