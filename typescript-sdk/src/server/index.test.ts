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
		server.tool("math", "Adds numbers", { a: z.number() }, async ({ a }) => ({
			content: [],
		}));

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
});
