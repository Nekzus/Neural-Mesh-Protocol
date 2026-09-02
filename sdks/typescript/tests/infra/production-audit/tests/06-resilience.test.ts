import { describe, expect, it } from "vitest";
import { callTool, liopEnvelope, mcpCall, extractText } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 06 — Chaos Engineering, Burst Stress & Network Resilience", () => {
	it("should handle burst of concurrent logic injection requests without node crash", async () => {
		const CONCURRENCY = 15;
		const promises = [];

		for (let i = 0; i < CONCURRENCY; i++) {
			const logic = `return { runId: ${i}, count: env.records.length };`;
			const envelope = liopEnvelope(logic, `Burst_${i}`);
			promises.push(callTool("Analyze_Synthetic_Bank_Transactions", envelope, NEXUS_URL, 40000));
		}

		const results = await Promise.allSettled(promises);
		const fulfilled = results.filter((r) => r.status === "fulfilled");
		console.log(`[Burst Concurrency] ${fulfilled.length}/${CONCURRENCY} calls returned within deadline`);

		// In a realistic WAN network, at least 85% must succeed under concurrency
		expect(fulfilled.length).toBeGreaterThanOrEqual(Math.floor(CONCURRENCY * 0.85));
	});

	it("should gracefully reject malformed envelopes without crashing worker isolate", async () => {
		const malformedEnvelopes = [
			"@LIOP{corrupted",
			"@LIOP{wasi_v1,Test} return 42; @WRONG_END",
			"plain javascript without envelope",
			"",
		];

		for (const env of malformedEnvelopes) {
			const res = await callTool("Analyze_Synthetic_Bank_Transactions", env, NEXUS_URL, 15000);
			const text = extractText(res);
			const isRejected =
				res?.isError === true ||
				/error|malformed|missing|invalid|throttled|violations|cooling/i.test(
					text,
				);
			expect(isRejected).toBe(true);
			expect(text.length).toBeGreaterThan(0);
		}
	});

	it("should handle invalid JSON-RPC method calls with standard error code -32601 or transcoder code -32099", async () => {
		const res = await mcpCall("non_existent_method", { param: "test" }, 777, NEXUS_URL);
		expect(res.error).toBeDefined();
		expect([-32601, -32099]).toContain(res.error?.code);
	});
});
