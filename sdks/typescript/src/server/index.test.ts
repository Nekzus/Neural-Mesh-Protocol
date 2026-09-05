// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "./index.js";

describe("LiopServer", () => {
	it("should initialize correctly with server info", () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		expect(server.getServerInfo()).toEqual({
			name: "test-server",
			version: "1.0.0",
		});
	});

	it("should allow tool registration", () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		server.tool(
			"echo",
			"Echoes input",
			{ message: z.string() },
			async ({ message }) => {
				return { content: [{ type: "text", text: message }] };
			},
		);

		const tools = server.listTools();
		expect(tools.length).toBe(1);
		expect(tools[0].name).toBe("echo");
		expect(tools[0].description).toBe("Echoes input");
	});

	it("should throw when registering a duplicate tool", () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		server.tool("echo", "Echoes input", { message: z.string() }, async () => ({
			content: [],
		}));

		expect(() => {
			server.tool("echo", "Duplicate", { msg: z.string() }, async () => ({
				content: [],
			}));
		}).toThrow("Tool already registered: echo");
	});

	it("should successfully call a registered tool", async () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		server.tool(
			"math",
			"Adds two numbers",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => {
				return { content: [{ type: "text", text: String(a + b) }] };
			},
		);

		const result = await server.callTool({
			name: "math",
			arguments: { a: 5, b: 3 },
		});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toBe("8");
	});

	it("should return a validation error internally if Zod parsing fails on tool call", async () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		server.tool(
			"math",
			"Adds numbers",
			{ a: z.number() },
			async ({ a: _a }) => ({
				content: [],
			}),
		);

		const result = await server.callTool({
			name: "math",
			arguments: { a: "not-a-number" },
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Validation Error");
	});

	it("should throw if calling an unregistered tool", async () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		await expect(server.callTool({ name: "ghost" })).rejects.toThrow(
			"Tool not found: ghost",
		);
	});

	it("should allow resource registration", () => {
		const server = new LiopServer({ name: "test-server", version: "1.0.0" });
		server.resource(
			"Documentation",
			"file:///docs",
			"System docs",
			"text/plain",
		);
		expect(() => server.resource("Duplicate", "file:///docs")).toThrowError(
			"Resource URI already registered: file:///docs",
		);
	});

	it("should provide a data dictionary resource", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.dataDictionary(
			{
				type: "object",
				properties: { test: { type: "string" } },
			},
			"App Schema",
			"liop://schema/app",
		);

		const resources = server.listResources();
		// 3 resources: auto-registered envelope-spec + guidelines + user dataDictionary
		expect(resources.length).toBe(3);
		expect(
			resources.some((r) => r.uri === "liop://protocol/envelope-spec"),
		).toBe(true);
		expect(resources.some((r) => r.uri === "liop://schema/guidelines")).toBe(
			true,
		);
		expect(resources.some((r) => r.uri === "liop://schema/app")).toBe(true);

		const content = await server.readResource("liop://schema/app");
		expect(JSON.stringify(content)).toContain("test");
	});

	it("should throw if reading an unregistered resource", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		await expect(server.readResource("liop://not-found")).rejects.toThrowError(
			"Resource not found: liop://not-found",
		);
	});

	it("should allow prompt registration and listing", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.prompt(
			"test-prompt",
			"A test prompt",
			[{ name: "arg1", description: "Arg 1", required: true }],
			(req) => ({
				messages: [
					{
						role: "user",
						content: { type: "text", text: `Prompt ${req.arguments?.arg1}` },
					},
				],
			}),
		);

		const prompts = server.listPrompts();
		expect(prompts.length).toBe(1);
		expect(prompts[0].name).toBe("test-prompt");

		const result = await server.getPrompt({
			name: "test-prompt",
			arguments: { arg1: "val" },
		});
		const content = result.messages[0].content;
		expect(content?.type).toBe("text");
		expect((content as Record<string, unknown>).text).toBe("Prompt val");
	});

	it("should throw if registering a duplicate prompt", () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.prompt("test", "A test", [], async () => ({ messages: [] }));
		expect(() =>
			server.prompt("test", "Duplicate", [], async () => ({ messages: [] })),
		).toThrowError("Prompt already registered: test");
	});

	it("should throw if getting an unregistered prompt", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		await expect(server.getPrompt({ name: "ghost" })).rejects.toThrowError(
			"Prompt not found: ghost",
		);
	});

	it("should detect malformed Logic-on-Origin payloads", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.tool("exec", "Exec", { payload: z.string() }, async () => ({
			content: [],
		}));

		// First call - should fail AST because it doesn't have Magic Bounds
		const res1 = await server.callTool({
			name: "exec",
			arguments: { payload: "console.log('malicious')" },
		});
		expect(res1.isError).toBe(true);
		expect(res1.content[0].text).toContain("Missing @LIOP");

		// Second call - should fail again with same payload (stat counter incremental)
		const res2 = await server.callTool({
			name: "exec",
			arguments: { payload: "console.log('malicious')" },
		});
		expect(res2.isError).toBe(true);
		expect(res2.content[0].text).toContain("Missing @LIOP");

		// After repeated attempts, should start accumulating connection failure logs (THROTTLE internally tested elsewhere)
	});

	it("should bypass AST Cache when __liop_bypass_ast_cache is true", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.tool(
			"exec",
			"Exec",
			{ payload: z.string(), __liop_bypass_ast_cache: z.boolean().optional() },
			async () => ({ content: [] }),
		);

		// 1. Fail AST initially
		await server.callTool({
			name: "exec",
			arguments: { payload: "malicious" },
		});

		// 2. The second call would normally hit cache, but we bypass
		const res2 = await server.callTool({
			name: "exec",
			arguments: { payload: "malicious", __liop_bypass_ast_cache: true },
		});
		expect(res2.isError).toBe(true);
		expect(res2.content[0].text).not.toContain("(Cached rejection)");
	});

	it("should trigger DoS protection LIOP_THROTTLED after max limit", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.tool("exec", "Exec", { payload: z.string() }, async () => ({
			content: [],
		}));

		// Send 5 malicious requests to trigger Fuel Rate Limiter
		for (let i = 0; i < 5; i++) {
			await server.callTool({
				name: "exec",
				arguments: { payload: "bad-payload" },
			});
		}

		// The 6th request should be immediately throttled
		const throttledRes = await server.callTool({
			name: "exec",
			arguments: { payload: "valid or bad doesn't matter" },
		});

		expect(throttledRes.isError).toBe(true);
		expect(throttledRes.content[0].text).toContain("LIOP_THROTTLED");
	});

	it("should rate limit tool calls exceeding max per window", async () => {
		const server = new LiopServer({ name: "test", version: "1" });
		server.tool("echo", "Echo", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));

		// Fire 15 calls (the new default max)
		for (let i = 0; i < 15; i++) {
			const r = await server.callTool({
				name: "echo",
				arguments: { msg: `call-${i}` },
			});
			expect(r.isError).toBeFalsy();
		}

		// The 16th call should be rate limited with retry-after
		const blocked = await server.callTool({
			name: "echo",
			arguments: { msg: "overflow" },
		});
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0].text).toContain("LIOP_RATE_LIMITED");
		expect(blocked.content[0].text).toContain("Retry after");
	});

	it("should respect custom rate limit from server options", async () => {
		const server = new LiopServer(
			{ name: "test", version: "1" },
			{ security: { rateLimit: { maxPerWindow: 3, windowMs: 60000 } } },
		);
		server.tool("echo", "Echo", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));

		for (let i = 0; i < 3; i++) {
			const r = await server.callTool({
				name: "echo",
				arguments: { msg: `call-${i}` },
			});
			expect(r.isError).toBeFalsy();
		}

		const blocked = await server.callTool({
			name: "echo",
			arguments: { msg: "overflow" },
		});
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0].text).toContain("LIOP_RATE_LIMITED");
	});

	it("should rate limit per-tool independently", async () => {
		const server = new LiopServer(
			{ name: "test", version: "1" },
			{ security: { rateLimit: { maxPerWindow: 2, windowMs: 60000 } } },
		);
		server.tool("toolA", "A", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));
		server.tool("toolB", "B", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));

		// Exhaust toolA limit
		await server.callTool({ name: "toolA", arguments: { msg: "1" } });
		await server.callTool({ name: "toolA", arguments: { msg: "2" } });

		// toolA should be blocked
		const blockedA = await server.callTool({
			name: "toolA",
			arguments: { msg: "3" },
		});
		expect(blockedA.isError).toBe(true);

		// toolB should still work independently
		const okB = await server.callTool({
			name: "toolB",
			arguments: { msg: "1" },
		});
		expect(okB.isError).toBeFalsy();
	});
	it("should terminate workers exceeding memory limits (heap bomb defense)", async () => {
		const server = new LiopServer(
			{ name: "test", version: "1" },
			{ workerPool: { maxHeapMb: 32 } },
		);
		server.tool(
			"exec",
			"Exec",
			{ payload: z.string() },
			async () => ({ content: [] }),
			{ enforceAggregationFirst: true },
		);
		server.setSandboxData([{ id: 1 }]);

		const result = await server.callTool({
			name: "exec",
			arguments: {
				payload: `@LIOP{wasi_v1,HeapBomb}
const a = [];
for (let i = 0; i < 5000000; i++) {
    a.push(i.toString() + 'X'.repeat(1000) + i.toString());
}
return { size: a.length };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/memory|heap|Worker|resource/i);
	});

	it("should enforce global cross-tool rate limit", async () => {
		const server = new LiopServer(
			{ name: "test", version: "1" },
			{
				security: {
					rateLimit: {
						maxPerWindow: 100,
						globalMaxPerWindow: 5,
						windowMs: 60000,
					},
				},
			},
		);
		server.tool("toolA", "A", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));
		server.tool("toolB", "B", { msg: z.string() }, async ({ msg }) => ({
			content: [{ type: "text", text: msg }],
		}));

		// Distribute calls across tools to stay under per-tool limit
		for (let i = 0; i < 3; i++) {
			await server.callTool({ name: "toolA", arguments: { msg: `${i}` } });
		}
		for (let i = 0; i < 2; i++) {
			await server.callTool({ name: "toolB", arguments: { msg: `${i}` } });
		}

		// 6th call should hit global limit
		const blocked = await server.callTool({
			name: "toolA",
			arguments: { msg: "overflow" },
		});
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0].text).toContain("LIOP_RATE_LIMITED");
		expect(blocked.content[0].text).toContain("Global");
	});
});
