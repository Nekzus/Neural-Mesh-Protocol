// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "../server/index.js";
import type { CallToolRequest, CallToolResult } from "../types.js";
import { TaintAnalyzer } from "./taint-analyzer.js";

describe("LIOP Tiered Query Budget Tests (Phase 136)", () => {
	describe("1. TaintAnalyzer Field Classification", () => {
		it("should classify fields correctly based on global forbidden and policy sensitive keys", () => {
			const forbiddenKeys = ["ssn", "password", "token"];
			const policySensitiveKeys = ["balance", "accountType"];

			const analyzer = new TaintAnalyzer(forbiddenKeys);

			// Test forbidden (global)
			expect(analyzer.classifyField("ssn", policySensitiveKeys)).toBe(
				"forbidden",
			);
			expect(analyzer.classifyField("Password", policySensitiveKeys)).toBe(
				"forbidden",
			); // Case-insensitive

			// Test sensitive (policy-level)
			expect(analyzer.classifyField("balance", policySensitiveKeys)).toBe(
				"sensitive",
			);
			expect(analyzer.classifyField("ACCOUNTTYPE", policySensitiveKeys)).toBe(
				"sensitive",
			); // Case-insensitive

			// Test public (neither forbidden nor sensitive)
			expect(analyzer.classifyField("age", policySensitiveKeys)).toBe("public");
			expect(analyzer.classifyField("currency", policySensitiveKeys)).toBe(
				"public",
			);
		});

		it("should classify fields correctly with sensitiveKeys configured at server-level", () => {
			const forbiddenKeys = ["ssn"];
			const analyzer = new TaintAnalyzer(forbiddenKeys, ["balance"]); // passing global sensitive keys

			expect(analyzer.classifyField("ssn")).toBe("forbidden");
			expect(analyzer.classifyField("balance")).toBe("sensitive");
			expect(analyzer.classifyField("age")).toBe("public");
		});
	});

	describe("2. LiopServer Tiered Budget Enforcement", () => {
		let server: LiopServer;
		let serverRef: {
			callTool: (
				request: CallToolRequest,
				clientId?: string,
			) => Promise<CallToolResult>;
		};

		beforeAll(() => {
			server = new LiopServer(
				{ name: "Budget-Test-Server", version: "1.0.0" },
				{
					security: {
						forbiddenKeys: ["ssn"],
						sensitiveKeys: ["balance"], // Global sensitive keys
						rateLimit: {
							maxPerWindow: 100,
							globalMaxPerWindow: 200,
						},
					},
				},
			);
			serverRef = server as unknown as {
				callTool: (
					request: CallToolRequest,
					clientId?: string,
				) => Promise<CallToolResult>;
			};

			// Register a test tool with tiered budget enabled
			server.tool(
				"analyze_data",
				"Analyze data",
				{ payload: z.string() },
				async () => ({ content: [] }),
				{
					enforceAggregationFirst: true,
					sensitiveKeys: ["email"], // Tool-level sensitive keys
				},
			);

			// Tool with legacy deprecated limit (retrocompatibility check)
			server.tool(
				"legacy_budget_tool",
				"Analyze legacy data",
				{ payload: z.string() },
				async () => ({ content: [] }),
				{
					enforceAggregationFirst: true,
					queryBudgetPerField: 5,
				},
			);
		});

		it("should enforce limits: 3 for forbidden keys", async () => {
			const payload = `@LIOP{wasi_v1,Task1}
env.records.forEach(r => {
	const x = r.ssn;
});
return { total: env.records.length };
@END`;

			// Reset budget between tests by changing client/session scope
			const client1 = "client-forbidden";

			// Exec 1, 2, 3 should succeed
			for (let i = 0; i < 3; i++) {
				const result = await serverRef.callTool(
					{ name: "analyze_data", arguments: { payload } },
					client1,
				);
				expect(result.isError).toBeFalsy();
			}

			// Exec 4 should fail
			const result4 = await serverRef.callTool(
				{ name: "analyze_data", arguments: { payload } },
				client1,
			);
			expect(result4.isError).toBe(true);
			expect(result4.content[0].text).toContain(
				"Query budget exceeded for field 'ssn'",
			);
			expect(result4.content[0].text).toContain("max 3 per session");
		});

		it("should enforce limits: 8 for sensitive keys", async () => {
			const payloadSensitive = `@LIOP{wasi_v1,Task2}
const b = env.records.reduce((acc, r) => acc + r.balance, 0);
return { b };
@END`;

			const client2 = "client-sensitive";

			// Exec 1 to 8 should succeed
			for (let i = 0; i < 8; i++) {
				const result = await serverRef.callTool(
					{ name: "analyze_data", arguments: { payload: payloadSensitive } },
					client2,
				);
				expect(result.isError).toBeFalsy();
			}

			// Exec 9 should fail
			const result9 = await serverRef.callTool(
				{ name: "analyze_data", arguments: { payload: payloadSensitive } },
				client2,
			);
			expect(result9.isError).toBe(true);
			expect(result9.content[0].text).toContain(
				"Query budget exceeded for field 'balance'",
			);
			expect(result9.content[0].text).toContain("max 8 per session");
		});

		it("should enforce limits: 25 for public keys", async () => {
			const payloadPublic = `@LIOP{wasi_v1,Task3}
const a = env.records.reduce((acc, r) => acc + r.age, 0);
return { a };
@END`;

			const client3 = "client-public";

			// Exec 1 to 25 should succeed
			for (let i = 0; i < 25; i++) {
				const result = await serverRef.callTool(
					{ name: "analyze_data", arguments: { payload: payloadPublic } },
					client3,
				);
				expect(result.isError).toBeFalsy();
			}

			// Exec 26 should fail
			const result26 = await serverRef.callTool(
				{ name: "analyze_data", arguments: { payload: payloadPublic } },
				client3,
			);
			expect(result26.isError).toBe(true);
			expect(result26.content[0].text).toContain(
				"Query budget exceeded for field 'age'",
			);
			expect(result26.content[0].text).toContain("max 25 per session");
		});

		it("should isolate budgets between different clients", async () => {
			const payloadForbidden = `@LIOP{wasi_v1,Task4}
env.records.forEach(r => {
	const x = r.ssn;
});
return { total: env.records.length };
@END`;

			const clientA = "client-a";
			const clientB = "client-b";

			// Client A exhausts the budget (3 calls)
			for (let i = 0; i < 3; i++) {
				const res = await serverRef.callTool(
					{ name: "analyze_data", arguments: { payload: payloadForbidden } },
					clientA,
				);
				expect(res.isError).toBeFalsy();
			}
			const resA = await serverRef.callTool(
				{ name: "analyze_data", arguments: { payload: payloadForbidden } },
				clientA,
			);
			expect(resA.isError).toBe(true); // Blocked

			// Client B should be able to execute (starts fresh)
			const resB = await serverRef.callTool(
				{ name: "analyze_data", arguments: { payload: payloadForbidden } },
				clientB,
			);
			expect(resB.isError).toBeFalsy(); // Succeeds!
		});

		it("should respect queryBudgetPerField fallback (retrocompatibility)", async () => {
			const payload = `@LIOP{wasi_v1,Task5}
const a = env.records.reduce((acc, r) => acc + r.age, 0);
return { a };
@END`;

			const clientLegacy = "client-legacy";

			// Limit is overridden to 5 (configured on tool policy)
			for (let i = 0; i < 5; i++) {
				const result = await serverRef.callTool(
					{ name: "legacy_budget_tool", arguments: { payload } },
					clientLegacy,
				);
				expect(result.isError).toBeFalsy();
			}

			const result6 = await serverRef.callTool(
				{ name: "legacy_budget_tool", arguments: { payload } },
				clientLegacy,
			);
			expect(result6.isError).toBe(true);
			expect(result6.content[0].text).toContain("max 5 per session");
		});
	});
});
