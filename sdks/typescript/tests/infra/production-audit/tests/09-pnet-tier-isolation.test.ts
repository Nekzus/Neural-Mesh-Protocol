/**
 * Production Audit Suite 09 — Tier 1 Enclave Isolation & Border LIO Gateway (pnet PSK)
 *
 * Implements RFC 0001 and Sovereign Mesh Operations Manual:
 * 1. Validates physical subnet and cryptographic PSK boundary of Tier 1 Sovereign Enclave.
 * 2. Validates Border LIO Gateway (BLG) multi-homed perimeter routing between Tier 1 & Tier 2.
 * 3. Validates that injected logic crosses BLG into enclaves in-situ and returns ZK-Receipts.
 * 4. Validates Aggregation-First raw data egress prevention across perimeter.
 */
import { describe, expect, it } from "vitest";
import { fetchWithRetry, liopEnvelope, mcpCall } from "./_helpers.js";

const BLG_URL = process.env.BLG_URL || "http://127.0.0.1:15018";
const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Suite 09 — Tier 1 Enclave Isolation & Border LIO Gateway (pnet PSK)", () => {
	it("PNET-01: BLG reports active Tier 1 Enclave PSK isolation and multi-tier subnets", async () => {
		const res = await fetchWithRetry(`${BLG_URL}/health`, {
			headers: { Accept: "application/json" },
		});
		expect(res.ok).toBe(true);

		const inspectRes = await mcpCall(
			"tools/call",
			{
				name: "BLG_Inspect_Enclave_Perimeter",
				arguments: {},
			},
			901,
			BLG_URL,
		);

		expect(inspectRes.error).toBeUndefined();
		expect(inspectRes.result).toBeDefined();
		const text = inspectRes.result?.content?.[0]?.text;
		expect(text).toBeDefined();

		const perimeterData = JSON.parse(text as string);
		expect(perimeterData.gatewayRole).toBe("Border LIO Gateway (BLG)");
		expect(perimeterData.pnetStatus).toBe("ACTIVE_ENCLAVE_PSK_ISOLATION");
		expect(perimeterData.tier1Subnet).toBe("172.22.0.0/24");
		expect(perimeterData.tier2Subnet).toBe("172.23.0.0/24");
		expect(perimeterData.defenseInDepth).toContain("Transport: pnet Swarm Key (95-byte PSK)");
	});

	it("PNET-02: BLG securely routes in-situ Healthcare Analytics into Tier 1 Enclave", async () => {
		const logic = [
			"const patients = env.records;",
			"const hypertensionCount = patients.filter(p => p.diagnosis === 'Hypertension').length;",
			"const avgAge = patients.length > 0 ? patients.reduce((s, p) => s + (p.age || 0), 0) / patients.length : 0;",
			"return {",
			"  totalPatients: patients.length,",
			"  hypertensionCount: hypertensionCount,",
			"  averageAge: Number(avgAge.toFixed(1))",
			"};",
		].join("\n");

		const logicPayload = liopEnvelope(logic, "HealthcareEnclaveAudit");

		const res = await mcpCall(
			"tools/call",
			{
				name: "BLG_Execute_Healthcare_Analytics",
				arguments: { envelope: logicPayload },
			},
			902,
			BLG_URL,
		);

		expect(res.error).toBeUndefined();
		expect(res.result).toBeDefined();
		expect(res.result?.isError).toBeFalsy();

		const contentText = res.result?.content?.[0]?.text;
		expect(contentText).toBeDefined();
		const data = JSON.parse(contentText as string);
		const comp = data.computation_result ?? data;

		// Assert verified aggregated metrics from Vault in Tier 1
		expect(comp.totalPatients).toBeGreaterThan(0);
		expect(comp.hypertensionCount).toBeDefined();
		expect(comp.averageAge).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
	});

	it("PNET-03: BLG securely routes in-situ Banking Analytics into Tier 1 Enclave", async () => {
		const logic = [
			"const accounts = env.records;",
			"const totalAccounts = accounts.length;",
			"const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);",
			"const avgBalance = totalAccounts > 0 ? totalBalance / totalAccounts : 0;",
			"return {",
			"  totalAccounts: totalAccounts,",
			"  totalBalance: Number(totalBalance.toFixed(2)),",
			"  avgBalance: Number(avgBalance.toFixed(2))",
			"};",
		].join("\n");

		const logicPayload = liopEnvelope(logic, "BankingEnclaveAudit");

		const res = await mcpCall(
			"tools/call",
			{
				name: "BLG_Execute_Banking_Analytics",
				arguments: { envelope: logicPayload },
			},
			903,
			BLG_URL,
		);

		expect(res.error).toBeUndefined();
		expect(res.result).toBeDefined();
		expect(res.result?.isError).toBeFalsy();

		const contentText = res.result?.content?.[0]?.text;
		expect(contentText).toBeDefined();
		const data = JSON.parse(contentText as string);
		const comp = data.computation_result ?? data;

		// Assert verified aggregated metrics from Bank in Tier 1
		expect(comp.totalAccounts).toBeGreaterThan(0);
		expect(comp.totalBalance).toBeGreaterThan(0);
		expect(comp.avgBalance).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
	});

	it("PNET-04: BLG enforces Aggregation-First Policy — blocks raw row export attempts", async () => {
		const rawExfiltration = [
			"return env.records.slice(0, 100).map(row => ({",
			"  id: row.id,",
			"  accountHolder: row.accountHolder,",
			"  balance: row.balance",
			"}));",
		].join("\n");

		const exfiltrationPayload = liopEnvelope(rawExfiltration, "ExfiltrationAttempt");

		const res = await mcpCall(
			"tools/call",
			{
				name: "BLG_Execute_Banking_Analytics",
				arguments: { envelope: exfiltrationPayload },
			},
			904,
			BLG_URL,
		);

		// Should either be rejected with error or contain policy block message
		const text = res.result?.content?.[0]?.text || "";
		const wasBlocked =
			res.result?.isError === true ||
			res.error !== undefined ||
			text.includes("Aggregation-First") ||
			text.includes("BLOCKED") ||
			text.includes("exfiltration");

		expect(wasBlocked).toBe(true);
	});

	it("PNET-05: BLG exposes tools to Consortium Mesh via Nexus discovery", async () => {
		const res = await mcpCall("tools/list", {}, 905, BLG_URL);

		expect(res.error).toBeUndefined();
		expect(res.result?.tools).toBeDefined();
		const toolNames = (res.result?.tools as Array<{ name: string }>).map((t) => t.name) || [];
		expect(toolNames).toContain("BLG_Inspect_Enclave_Perimeter");
		expect(toolNames).toContain("BLG_Execute_Healthcare_Analytics");
		expect(toolNames).toContain("BLG_Execute_Banking_Analytics");
	});

	it("PNET-06: Dual-homed network architecture prevents direct WAN discovery of enclave", async () => {
		// Tier 3 Backbone should discover Nexus and Relay, but NOT raw Enclave endpoints
		const res = await fetchWithRetry(`${NEXUS_URL}/health`, {
			headers: { Accept: "application/json" },
		});
		expect(res.ok).toBe(true);

		// Verify that Nexus health endpoint does not leak Tier 1 internal IP
		const healthData = (await res.json()) as Record<string, unknown>;
		const healthStr = JSON.stringify(healthData);
		expect(healthStr).not.toContain("172.22.0.11");
		expect(healthStr).not.toContain("172.22.0.12");
	});
});
