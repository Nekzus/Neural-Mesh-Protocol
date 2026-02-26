import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NmpMcpBridge, NmpServer } from "../src/index.js";

describe("NmpMcpBridge", () => {
	it("should error on invalid JSON-RPC version", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		const res = await bridge.handleJsonRpcRequest({
			jsonrpc: "1.0",
			id: 1,
			method: "tools/list",
		});
		expect(res.error).toBeDefined();
		expect(res.error.message).toBe("Invalid Request");
	});

	it("should list tools using standard MCP ping", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.tool("example", "Test tool", { param: z.string() }, async () => ({
			content: [],
		}));

		const bridge = new NmpMcpBridge(server);
		const res = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: "req_1",
			method: "tools/list",
		});

		expect(res.result.tools).toBeDefined();
		expect(res.result.tools.length).toBe(1);
		expect(res.result.tools[0].name).toBe("example");
	});

	it("should natively route a tools/call request and execute it", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.tool("greet", "Greeting", { name: z.string() }, async ({ name }) => {
			return { content: [{ type: "text", text: `Hello ${name}` }] };
		});

		const bridge = new NmpMcpBridge(server);
		const payload = {
			jsonrpc: "2.0",
			id: "req_2",
			method: "tools/call",
			params: { name: "greet", arguments: { name: "Mesh" } },
		};

		const res = await bridge.handleJsonRpcRequest(payload);
		expect(res.result.content[0].text).toBe("Hello Mesh");
		expect(res.error).toBeUndefined();
	});

	it("should gracefully handle missing parameters in tools/call", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		const res = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {}, // Missing tool name
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32602);
	});
});
