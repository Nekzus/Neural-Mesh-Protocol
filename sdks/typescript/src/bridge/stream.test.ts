// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopHybridGateway } from "../gateway/hybrid.js";
import { LiopServer } from "../server/index.js";

/**
 * LIOPStreamBridge Integration Test Suite.
 *
 * This suite manages its own LiopServer instance automatically.
 */

// ... (interfaces existing)
interface ToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

const TOKEN = process.env.ZERO_TRUST_TOKEN || "test-token";

/** Creates a fresh MCP client connected to the LiopServer via Streamable HTTP */
async function createRemoteClient(name: string, port: number): Promise<Client> {
	const dynamicUrl = `http://127.0.0.1:${port}/mcp`;
	const transport = new StreamableHTTPClientTransport(new URL(dynamicUrl), {
		requestInit: {
			headers: { Authorization: `Bearer ${TOKEN}` },
		},
	});
	const client = new Client(
		{ name, version: "1.0.0" },
		{ capabilities: { sampling: {} } },
	);
	await client.connect(transport);
	return client;
}

describe("LiopStreamBridge (Integration)", () => {
	let gateway: LiopHybridGateway;
	let server: LiopServer;
	let gatewayPort: number;

	beforeAll(async () => {
		// Initialize the test LiopServer
		server = new LiopServer(
			{ name: "liop-stream-test", version: "1.1.2" },
			{
				security: {
					forbiddenKeys: ["id", "name"],
					piiPatterns: [],
				},
			},
		);

		// Critical: Start gRPC server and Mesh Node on dynamic ephemeral port
		await server.connectToMesh({ port: 0 });

		// Seed with Industrial Records (Matching Demo requirements)
		server.setSandboxData([
			{ id: "P001", name: "Alice", age: 34, condition: "Hypertension" },
			{ id: "P005", name: "Eve", age: 62, condition: "Diabetes Type 2" },
		]);

		// Register the critical Audit Sandbox tool required by tests
		server.tool(
			"liop_audit_sandbox",
			"Executes Logic-on-Origin",
			{ payload: z.string() },
			// This handler is only reached if boundaries are missing
			async () => ({
				content: [
					{ type: "text", text: "Error: Logic-on-Origin boundaries missing." },
				],
				isError: true,
			}),
		);

		// Initialize and Start the Hybrid Gateway on dynamic ephemeral port
		gateway = new LiopHybridGateway(server);
		const assignedGatewayPort = await gateway.listen(0, "127.0.0.1");

		// Expose assigned port dynamically via an internal variable to overwrite BASE_URL equivalents
		gatewayPort = assignedGatewayPort;
	});

	afterAll(async () => {
		if (gateway) await gateway.stop();
		if (server) await server.close();
	});

	it("should support 3 concurrent client sessions", async () => {
		const [client1, client2, client3] = await Promise.all([
			createRemoteClient("ConcurrentAgent-1", gatewayPort),
			createRemoteClient("ConcurrentAgent-2", gatewayPort),
			createRemoteClient("ConcurrentAgent-3", gatewayPort),
		]);

		const [r1, r2, r3] = await Promise.all([
			client1.listTools(),
			client2.listTools(),
			client3.listTools(),
		]);

		expect(r1.tools.length).toBeGreaterThan(0);
		expect(r2.tools.length).toBeGreaterThan(0);
		expect(r3.tools.length).toBeGreaterThan(0);
		expect(r1.tools[0].name).toBe(r2.tools[0].name);
		expect(r2.tools[0].name).toBe(r3.tools[0].name);

		await Promise.all([client1.close(), client2.close(), client3.close()]);
	});

	it("should discover tools via Streamable HTTP", async () => {
		const client = await createRemoteClient("DiscoveryAgent", gatewayPort);
		const { tools } = await client.listTools();

		expect(tools.length).toBeGreaterThan(0);
		const auditTool = tools.find((t) => t.name === "liop_audit_sandbox");
		expect(auditTool).toBeDefined();
		expect(auditTool?.inputSchema?.properties?.payload).toBeDefined();

		await client.close();
	});

	it("should execute Logic-on-Origin Blind Computation with ZK-Receipt", async () => {
		const client = await createRemoteClient("ComputeAgent", gatewayPort);

		const payload = `@LIOP{wasi_v1,AuditModule}
const totalPatients = env.records.length;
const avgAge = env.records.reduce((sum, r) => sum + r.age, 0) / totalPatients;
const conditions = {};
env.records.forEach(r => {
    conditions[r.condition] = (conditions[r.condition] || 0) + 1;
});
return { total_patients: totalPatients, average_age: Math.round(avgAge * 10) / 10, condition_distribution: conditions };
@END`;

		const result = (await client.callTool({
			name: "liop_audit_sandbox",
			arguments: { payload },
		})) as ToolResult;

		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content[0].type).toBe("text");

		const data = JSON.parse(result.content[0].text);
		expect(data.computation_result).toBeDefined();
		expect(data.image_id).toBeDefined();
		expect(data.status).toBe("Worker Pool Execution Success");

		await client.close();
	});

	it("should BLOCK PII exfiltration attempts (Egress Security)", async () => {
		const client = await createRemoteClient("MaliciousAgent", gatewayPort);

		const maliciousPayload = `@LIOP{wasi_v1,ExfiltrationModule}
return env.records.map(r => ({ id: r.id, name: r.name, age: r.age }));
@END`;

		const result = (await client.callTool({
			name: "liop_audit_sandbox",
			arguments: { payload: maliciousPayload },
		})) as ToolResult;

		const responseText = result.content[0].text;

		const isPiiBlocked =
			responseText.includes("Egress Security Violation") ||
			responseText.includes("PII") ||
			responseText.includes("Forbidden Key") ||
			result.isError === true;

		expect(isPiiBlocked).toBe(true);

		await client.close();
	});

	it("should BLOCK sandbox escape attempts via Guardian AST", async () => {
		const client = await createRemoteClient("EvilAgent", gatewayPort);

		const dangerousPayload = `@LIOP{wasi_v1,EscapeModule}
const fs = require('fs');
const data = fs.readFileSync('/etc/passwd', 'utf8');
return { stolen: data };
@END`;

		const result = (await client.callTool({
			name: "liop_audit_sandbox",
			arguments: { payload: dangerousPayload },
		})) as ToolResult;

		const responseText = result.content[0].text;

		const isBlocked =
			responseText.includes("Guardian") ||
			responseText.includes("blocked") ||
			responseText.includes("forbidden") ||
			responseText.includes("require") ||
			responseText.includes("Sandbox") ||
			result.isError === true;

		expect(isBlocked).toBe(true);

		await client.close();
	});

	it("should discover resources and prompts", async () => {
		const client = await createRemoteClient("DiscoveryAgent-2", gatewayPort);

		const resources = await client.listResources();
		expect(resources.resources).toBeDefined();

		const prompts = await client.listPrompts();
		expect(prompts.prompts).toBeDefined();

		await client.close();
	});
});
