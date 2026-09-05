/**
 * LIOP High-Frequency Burst Stress Integration Tests
 *
 * Validates the thread pool concurrency and worker stability of the LiopServer
 * under a heavy concurrent burst of 100+ legitimate transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "../../src/server/index.js";

describe("LIOP High-Frequency Concurrency Stress Tests", () => {
	let server: LiopServer;

	beforeAll(async () => {
		server = new LiopServer(
			{ name: "Burst-Stress-Server", version: "1.0.0" },
			{
				workerPool: {
					minThreads: 2,
					maxThreads: 8,
					maxQueue: 200,
				},
				security: {
					forbiddenKeys: ["pii_secret"],
					rateLimit: {
						maxPerWindow: 200,
						globalMaxPerWindow: 200,
						windowMs: 60000,
					},
				},
			},
		);

		// Register a legitimate tool that executes math logic
		server.tool(
			"calculate_stats",
			"Perform basic statistical mathematical analysis",
			{ payload: z.string() },
			async () => ({ content: [] }),
			{
				enforceAggregationFirst: true,
				queryBudgetPerField: 200,
			},
		);

		// Seed dummy numeric records for calculation
		const dummyRecords = Array.from({ length: 50 }, (_, i) => ({
			id: i,
			value: i * 2,
			pii_secret: `secret-${i}`, // forbidden key
		}));
		server.setSandboxData(dummyRecords);
	});

	afterAll(async () => {
		await server.close();
	});

	it("should handle a concurrent burst of 100+ requests without failure or worker pool degradation", async () => {
		const CONCURRENT_REQUESTS = 105;
		const promises: Promise<any>[] = [];

		const startTime = performance.now();

		for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
			promises.push(
				server.callTool({
					name: "calculate_stats",
					arguments: {
						payload: `@LIOP{wasi_v1,Burst_Query_${i}}
const r = env.records;
const sum = r.reduce((s, x) => s + x.value, 0);
return { average: sum / r.length };
@END`,
					},
				}),
			);
		}

		const results = await Promise.all(promises);
		const elapsedTime = performance.now() - startTime;

		// Assert that all requests completed successfully
		for (const result of results) {
			if (result.isError) {
				console.error("TOOL CONCURRENCY ERROR TEXT:", result.content[0].text);
			}
			expect(result.isError).toBeFalsy();
			const content = JSON.parse(result.content[0].text!);
			expect(content.computation_result.average).toBe(49); // (sum from 0 to 49 of i*2) / 50 = (2 * (49 * 50 / 2)) / 50 = 49
			expect(content.zk_receipt).toBeDefined();
			expect(content.status).toBe("Worker Pool Execution Success");
		}

		// Performance Metrics
		const avgLatency = elapsedTime / CONCURRENT_REQUESTS;
		console.log(`[Burst Stress Test] Completed ${CONCURRENT_REQUESTS} requests in ${elapsedTime.toFixed(2)}ms.`);
		console.log(`[Burst Stress Test] Average Latency per request: ${avgLatency.toFixed(2)}ms.`);

		// Safety constraints
		expect(elapsedTime).toBeLessThan(15000); // Must complete within 15 seconds under local development thread pools
	}, 20000); // 20-second Vitest timeout hook
});
