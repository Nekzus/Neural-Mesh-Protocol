import { describe, expect, it } from "vitest";
import { z } from "zod";
import crypto from "node:crypto";
import { NmpServer } from "../server/index.js";
import { NmpMcpBridge } from "./index.js";

describe("NmpMcpBridge", () => {
	it("should error on invalid JSON-RPC version", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
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
		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
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

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest(payload);
		expect(res.result.content[0].text).toBe("Hello Mesh");
		expect(res.error).toBeUndefined();
	});

	it("should gracefully handle missing parameters in tools/call", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {}, // Missing tool name
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32602);
	});

	it("should handle resources/read correctly", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.resource("test_res", "nmp://test", "desc", "text/plain", "content");
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 4,
			method: "resources/read",
			params: { uri: "nmp://test" },
		});

		expect(res.result.contents[0].text).toBe("content");
	});

	it("should error if resources/read misses uri", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 5,
			method: "resources/read",
			params: {}, // Missing uri
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32602);
	});

	it("should catch errors thrown by internalServer.readResource", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 6,
			method: "resources/read",
			params: { uri: "nmp://not-found" },
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32000);
	});

	it("should catch internal execution errors in tools/call", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		server.tool("fail", "Fail Tool", {}, async () => {
			throw new Error("Simulated failure");
		});

		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: { name: "fail", arguments: {} },
		});

		// Based on NmpServer implementation, it catches the error and returns it inside content with isError: true
		// Let's verify this behavior:
		expect(res.result.isError).toBe(true);
		expect(res.result.content[0].text).toContain("Simulated failure");
	});

	it("should return Method not found for unknown methods", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 8,
			method: "unknown/method",
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32601);
	});

	it("should return error if prompts/get misses name", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 9,
			method: "prompts/get",
			params: {}, // Missing name
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32602);
	});

	it("should catch error if prompts/get fails", async () => {
		const server = new NmpServer({ name: "test", version: "1" });
		const bridge = new NmpMcpBridge(server);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const res: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 10,
			method: "prompts/get",
			params: { name: "not-found" },
		});

		expect(res.error).toBeDefined();
		expect(res.error.code).toBe(-32000);
	});

	it("should allow execution when image_id mathematically matches the payload (Zero-Trust Success)", async () => {
		const server = new NmpServer({ name: "test", version: "1.0.0" });
		const bridge = new NmpMcpBridge(server);

		const testPayload = "---BEGIN_LOGIC---\nreturn 'hello world';\n---END_LOGIC---";
		// The real server only hashes the extracted logic payload
		const expectedHash = crypto.createHash("sha256").update("return 'hello world';").digest("hex");

		// Mock a server tool that returns a valid ZK-Receipt footprint
		server.tool(
			"test_tool",
			"Test logic",
			{ payload: z.string() },
			async () => {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								result: "success",
								image_id: expectedHash,
								zk_receipt: "0xVALID",
							}),
						},
					],
				};
			},
		);

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const response: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 11,
			method: "tools/call",
			params: {
				name: "test_tool",
				arguments: { payload: testPayload },
			},
		});

		expect(response.error).toBeUndefined();
		expect(response.result).toBeDefined();

		const contentText = response.result.content[0].text;
		expect(contentText).toContain("✅ ZK-Receipt & ImageID Mathematically Verified");
	});

	it("should BLOCK execution and return MCP error when image_id is adulterated (Hack Simulation)", async () => {
		const server = new NmpServer({ name: "test", version: "1.0.0" });
		const bridge = new NmpMcpBridge(server);

		const testPayload = "---BEGIN_LOGIC---\nreturn 'clean code';\n---END_LOGIC---";

		// The server is compromised and returns a different image_id
		const maliciousPayload = "---BEGIN_LOGIC---\nreturn 'hacked_code';\n---END_LOGIC---";
		const maliciousHash = crypto.createHash("sha256").update("return 'hacked_code';").digest("hex");

		// Override the internal server's tool call directly so it returns a hacked proof 
		// (bypassing the internal worker pool which naturally corrects it)
		bridge["internalServer"].callTool = async () => {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							result: "stolen data",
							image_id: maliciousHash, // Mismatch!
							zk_receipt: "0xCOMPROMISED",
						}),
					},
				],
				isError: false,
			};
		};

		// biome-ignore lint/suspicious/noExplicitAny: test assertion bounds
		const response: any = await bridge.handleJsonRpcRequest({
			jsonrpc: "2.0",
			id: 12,
			method: "tools/call",
			params: {
				name: "test_tool",
				arguments: { payload: testPayload },
			},
		});

		expect(response.error).toBeUndefined(); // MCP frame is ok
		expect(response.result.isError).toBe(true); // Inner execution blocked

		const contentText = response.result.content[0].text;
		expect(contentText).toContain("🚨 [NMP ZERO-TRUST SHIELD] ZK Verification Failed");
	});

});
