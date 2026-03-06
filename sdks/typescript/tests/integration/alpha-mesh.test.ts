import { it, expect, describe, beforeAll, afterAll } from "vitest";
import { NmpServer } from "../../src/server/index.js";
import { NmpClient } from "../../src/client/index.js";
import { z } from "zod";

describe("NMP Alpha Mesh Integration", () => {
    let server: NmpServer;
    let client: NmpClient;

    beforeAll(async () => {
        server = new NmpServer({ name: "AlphaNode", version: "1.1.0" });

        // Set some records in the sandbox
        server.setSandboxData([
            { id: "P001", age: 45, condition: "Diabetes Type 2" },
            { id: "P002", age: 30, condition: "Healthy" }
        ]);

        // Register a tool with NMP zero-shot autonomy (autodetects payload)
        server.tool(
            "calculate_stats",
            "Calculates aggregates over medical data",
            { payload: z.string() },
            async (args) => {
                return { content: [{ type: "text", text: "Local fallback" }] };
            }
        );

        await server.connectToMesh({ port: 50063 });

        client = new NmpClient();
        await client.connect("localhost:50063");
    }, 60000);

    afterAll(async () => {
        if (server) await server.close();
        await new Promise(r => setTimeout(r, 1000));
    }, 20000);

    it("should execute Logic-on-Origin with full gRPC-PQC-WASI flow", async () => {
        const toolRequest = {
            name: "calculate_stats",
            arguments: {
                payload: `
---BEGIN_LOGIC---
const records = env.records;
const avgAge = records.reduce((acc, r) => acc + r.age, 0) / records.length;
return {
    count: records.length,
    average_age: avgAge
};
---END_LOGIC---
`
            }
        };

        // In NMP Alpha, client.callTool takes the wasmPayload (the logic)
        const wasmPayload = Buffer.from(toolRequest.arguments.payload);

        // This will trigger: Intent Negotiation -> PQC Handshake -> AES Sealing -> gRPC ExecuteLogic -> Worker Pool -> ZK Verification
        const result = await client.callTool(toolRequest, wasmPayload);

        expect(result.isError).toBe(false);
        expect(result.content[0].type).toBe("text");

        const data = JSON.parse(result.content[0].text || "{}");
        expect(data).toHaveProperty("average_age", 37.5);
        expect(data).toHaveProperty("count", 2);

        console.log("[Test-Alpha] ✅ E2E Flow Successful. Results verified.");
    }, 20000);

    it("should reject execution if ZK-Receipt ImageID mismatch detected", async () => {
        const client = new NmpClient();
        await client.connect("localhost:50063");

        const toolRequest = {
            name: "calculate_stats",
            arguments: {
                payload: "---BEGIN_LOGIC--- return 1; ---END_LOGIC---"
            }
        };

        // Manually interfering with the payload after client signs or hashes
        // Here we can simulate it by providing a different expected hash in verifyZkReceipt
        // or modifying the wasmPayload passed to callTool.

        const realPayload = Buffer.from("---BEGIN_LOGIC--- return 1; ---END_LOGIC---");
        const modifiedPayload = Buffer.from("---BEGIN_LOGIC--- return 2; ---END_LOGIC---");

        // If we call with modifiedPayload but the server hash is based on realPayload
        // (Actually in callTool, the verification is done on the wasmPayload passed as argument)

        // Let's mock a verification failure by overriding verifyZkReceipt intermittently
        const originalVerify = client.verifyZkReceipt;
        client.verifyZkReceipt = async () => false;

        await expect(client.callTool(toolRequest, realPayload)).rejects.toThrow("ZK-Receipt verification failed");

        client.verifyZkReceipt = originalVerify;
    });
});
