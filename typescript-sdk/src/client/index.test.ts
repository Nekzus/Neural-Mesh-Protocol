/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { NmpClient } from "./index.js";
import { Buffer } from "node:buffer";

describe("NmpClient", () => {
	it("should throw an error if attempting to execute without connection", async () => {
		const client = new NmpClient({ name: "test-agent", version: "1.0.0" });

		const mockServerPublicKey = new Uint8Array(1184);
		const mockWasmPayload = Buffer.from("mock");

		await expect(client.callTool({ name: "any" }, mockWasmPayload, mockServerPublicKey)).rejects.toThrow(
			"Client must be connected before calling tools.",
		);
		await expect(client.discoverTools()).rejects.toThrow(
			"Client must be connected before discovering tools.",
		);
	});

	it("should successfully connect and mock capability discovery", async () => {
		const client = new NmpClient({ name: "test-agent", version: "1.0.0" });
		await client.connect();

		const serverInfo = client.getServerInfo();
		expect(serverInfo).toBeDefined();
		expect(serverInfo?.name).toContain("Mesh Connected");

		const tools = await client.discoverTools();
		expect(tools.length).toBeGreaterThan(0);
		expect(tools[0].name).toBe("read_logs");
	});

	it("should simulate execution after connection", async () => {
		const client = new NmpClient({ name: "test-agent", version: "1.0.0" });
		await client.connect();

		// Mock a 1184-byte Kyber768 array and a dummy WASM Buffer
		const mockServerPublicKey = new Uint8Array(1184);
		const mockWasmPayload = Buffer.from("mock-wasm-binary-data");

		const res = await client.callTool({ name: "read_logs", arguments: {} }, mockWasmPayload, mockServerPublicKey);
		expect(res.isError).toBeFalsy();
		expect(res.content[0].text).toContain("Secure Execution Dispatched");
		expect(res.content[0].text).toContain("bytes (Encrypted)");
	});
});
