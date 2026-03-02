import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NmpServer } from "./index.js";

describe("NmpServer", () => {
	it("should initialize correctly with server info", () => {
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
		expect(server.getServerInfo()).toEqual({
			name: "test-server",
			version: "1.0.0",
		});
	});

	it("should allow tool registration", () => {
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
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
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
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
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
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
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
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
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
		await expect(server.callTool({ name: "ghost" })).rejects.toThrow(
			"Tool not found: ghost",
		);
	});

	it("should allow resource registration", () => {
		const server = new NmpServer({ name: "test-server", version: "1.0.0" });
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

	it("should provide a data dictionary resource", () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.dataDictionary(
			{
				type: "object",
				properties: { test: { type: "string" } },
			},
			"App Schema",
			"nmp://schema/app",
		);

		const resources = server.listResources();
		expect(resources.length).toBe(1);
		expect(resources[0].uri).toBe("nmp://schema/app");

		const content = server.readResource("nmp://schema/app");
		expect(JSON.stringify(content)).toContain("test");
	});

	it("should throw if reading an unregistered resource", () => {
		const server = new NmpServer({ name: "test", version: "1" });
		expect(() => server.readResource("nmp://not-found")).toThrowError(
			"Resource not found: nmp://not-found",
		);
	});

	it("should allow prompt registration and listing", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
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
		const server = new NmpServer({ name: "test", version: "1" });
		server.prompt("test", "A test", [], async () => ({ messages: [] }));
		expect(() =>
			server.prompt("test", "Duplicate", [], async () => ({ messages: [] })),
		).toThrowError("Prompt already registered: test");
	});

	it("should throw if getting an unregistered prompt", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		await expect(server.getPrompt({ name: "ghost" })).rejects.toThrowError(
			"Prompt not found: ghost",
		);
	});

	it("should detect malformed Logic-on-Origin payloads", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.tool("exec", "Exec", { payload: z.string() }, async () => ({
			content: [],
		}));

		// First call - should fail AST because it doesn't have Magic Bounds
		const res1 = await server.callTool({
			name: "exec",
			arguments: { payload: "console.log('malicious')" },
		});
		expect(res1.isError).toBe(true);
		expect(res1.content[0].text).toContain(
			"Malformed payload. Missing magic bytes",
		);

		// Second call - should fail again with same payload (stat counter incremental)
		const res2 = await server.callTool({
			name: "exec",
			arguments: { payload: "console.log('malicious')" },
		});
		expect(res2.isError).toBe(true);
		expect(res2.content[0].text).toContain(
			"Malformed payload. Missing magic bytes",
		);

		// After repeated attempts, should start accumulating connection failure logs (THROTTLE internally tested elsewhere)
	});

	it("should bypass AST Cache when __nmp_bypass_ast_cache is true", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.tool(
			"exec",
			"Exec",
			{ payload: z.string(), __nmp_bypass_ast_cache: z.boolean().optional() },
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
			arguments: { payload: "malicious", __nmp_bypass_ast_cache: true },
		});
		expect(res2.isError).toBe(true);
		expect(res2.content[0].text).not.toContain("(Cached rejection)");
	});

	it("should trigger DoS protection NMP_THROTTLED after max limit", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
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
		expect(throttledRes.content[0].text).toContain("NMP_THROTTLED");
	});
});
