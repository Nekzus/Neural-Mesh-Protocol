import { describe, expect, it } from "vitest";
import { waitForHealthy, listTools, mcpCall } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";
const VAULT_URL = process.env.VAULT_URL || "http://127.0.0.1:15013";
const BANK_URL = process.env.BANK_URL || "http://127.0.0.1:15014";
const ORACLE_URL = process.env.ORACLE_URL || "http://127.0.0.1:15015";
const EDGE_URL = process.env.EDGE_URL || "http://127.0.0.1:15016";
const RELAY_URL = process.env.RELAY_URL || "http://127.0.0.1:15017";
const PLAYGROUND_URL = process.env.PLAYGROUND_URL || "http://127.0.0.1:16000";

describe("Production Audit Suite 01 — Realistic WAN P2P Mesh Convergence", () => {
	it("should verify all 7 distributed nodes report status=healthy over WAN", async () => {
		const nodes = [
			{ name: "Nexus (Seed)", url: NEXUS_URL },
			{ name: "Vault (Healthcare)", url: VAULT_URL },
			{ name: "Bank (Finance)", url: BANK_URL },
			{ name: "Oracle (HFT)", url: ORACLE_URL },
			{ name: "Edge (Hostile 3G)", url: EDGE_URL },
			{ name: "Relay (NAT Traversal)", url: RELAY_URL },
			{ name: "Playground (Client SDK)", url: PLAYGROUND_URL },
		];

		for (const node of nodes) {
			const res = await waitForHealthy(node.url, 45000);
			expect(res.status).toBe("healthy");
			console.log(`[Health OK] ${node.name} at ${node.url}`);
		}
	});

	it("should discover all core tools through Nexus gateway via Kademlia DHT", async () => {
		const tools = await listTools(NEXUS_URL);
		const toolNames = tools.map((t) => t.name);
		console.log(`[Discovered Tools via WAN DHT] ${toolNames.join(", ")}`);

		expect(toolNames).toContain("Analyze_Synthetic_Bank_Transactions");
		expect(toolNames).toContain("Analyze_Synthetic_Medical_Records");
		expect(toolNames).toContain("Analyze_HFT_Market_Data");
		expect(toolNames).toContain("LiopMeshStatus");
	});

	it("should discover edge IoT capability despite severe hostile 3G network latency", async () => {
		const tools = await listTools(NEXUS_URL);
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain("Analyze_IoT_Sensor_Data");
	});

	it("should verify LiopMeshStatus returns active connections with multi-region nodes", async () => {
		const res = await mcpCall(
			"tools/call",
			{
				name: "LiopMeshStatus",
				arguments: {},
			},
			1001,
			NEXUS_URL,
		);

		expect(res.error).toBeUndefined();
		const text = res.result?.content?.[0]?.text;
		expect(text).toBeDefined();
		expect(text).toContain("LIOP Mesh Status: Active");
		expect(text).toMatch(/\d+ Conns/);
	});
});
