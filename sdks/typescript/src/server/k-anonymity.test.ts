// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "./index.js";

/**
 * LIOP K-Anonymity & Egress Security Suite
 * Validates that the mesh node correctly restricts output precision
 * based on the source dataset size to prevent statistical inference.
 */
describe("K-Anonymity Security Enforcement", () => {
	let server: LiopServer;

	beforeEach(() => {
		server = new LiopServer({
			name: "K-Anonymity Test Server",
			version: "1.0.0",
		});
	});

	afterEach(async () => {
		await server.close();
	});

	it("should allow detailed aggregation when dataset size >= 10", async () => {
		// Setup 10 mock records (K-Anonymity Threshold met)
		const records = Array.from({ length: 10 }, (_, i) => ({
			id: i,
			val: i * 10,
		}));
		server.setSandboxData(records);

		server.tool(
			"test_aggregation",
			"Test tool",
			{ payload: z.string() },
			async () => {
				// Egress Shield scans the final output returned from worker
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ avg: 50, count: 10, details: [1, 2, 3] }),
						},
					],
				};
			},
			{ enforceAggregationFirst: true },
		);

		const result = await server.callTool({
			name: "test_aggregation",
			arguments: {
				payload:
					"@LIOP{wasi_v1,test}\nreturn {avg: 50, count: 10, details: [1, 2, 3]}\n@END",
			},
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain('"avg":');
	});

	it("should block complex aggregation when dataset size < 10 (K-Anonymity Violation)", async () => {
		// Setup only 3 records (Below K-Anonymity Threshold)
		const records = Array.from({ length: 3 }, (_, i) => ({
			id: i,
			val: i * 10,
		}));
		server.setSandboxData(records);

		server.tool(
			"test_small_dataset",
			"Test tool",
			{ payload: z.string() },
			async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({ avg: 10, count: 3, details: [0, 10, 20] }),
					},
				],
			}),
			{ enforceAggregationFirst: true },
		);

		// Enable verbose security logging for verification
		process.env.LIOP_SEC_VERBOSE = "1";

		const result = await server.callTool({
			name: "test_small_dataset",
			arguments: {
				payload:
					"@LIOP{wasi_v1,test}\nreturn {avg: 10, count: 3, details: [0, 10, 20]}\n@END",
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("K-Anonymity violation");

		delete process.env.LIOP_SEC_VERBOSE;
	});

	it("should obfuscate security errors in production mode (NODE_ENV=production)", async () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		delete process.env.LIOP_SEC_VERBOSE;

		const records = [{ id: 1 }];
		server.setSandboxData(records);

		server.tool(
			"prod_test",
			"Test tool",
			{ payload: z.string() },
			async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							too: "much",
							detail: "here",
							and: "more",
							extra: "field",
						}),
					},
				],
			}),
			{ enforceAggregationFirst: true },
		);

		const result = await server.callTool({
			name: "prod_test",
			arguments: {
				payload:
					"@LIOP{wasi_v1,test}\nreturn {too:'much', detail:'here', and:'more', extra:'field'}\n@END",
			},
		});

		expect(result.isError).toBe(true);
		// Should NOT contain specific details about K-Anonymity or internal policies
		expect(result.content[0].text).toBe(
			"[LIOP] Egress Security Violation. Output blocked due to policy enforcement. Ensure your logic uses strictly aggregated, non-PII patterns.",
		);

		process.env.NODE_ENV = originalEnv;
	});

	it("should allow simple global counts even for small datasets", async () => {
		const records = [{ id: 1 }, { id: 2 }];
		server.setSandboxData(records);

		server.tool(
			"test_simple_count",
			"Test tool",
			{ payload: z.string() },
			async () => ({
				content: [{ type: "text", text: JSON.stringify({ total: 2 }) }],
			}),
			{ enforceAggregationFirst: true },
		);

		const result = await server.callTool({
			name: "test_simple_count",
			arguments: {
				payload: "@LIOP{wasi_v1,test}\nreturn {total: 2}\n@END",
			},
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain('"total":');
	});
});
