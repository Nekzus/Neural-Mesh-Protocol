/// <reference types="node" />

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { NmpClient } from "./index.js";

describe("NmpClient", () => {
	it("should throw an error if attempting to execute without connection", async () => {
		const client = new NmpClient();

		const mockServerPublicKey = new Uint8Array(1184);
		const mockWasmPayload = Buffer.from("mock");

		await expect(
			client.callTool({ name: "any" }, mockWasmPayload),
		).rejects.toThrow("Client must be connected before calling tools.");
		await expect(client.discoverTools()).rejects.toThrow(
			"Client must be connected before discovering tools.",
		);
	});

	it("should successfully connect and mock capability discovery", async () => {
		const client = new NmpClient();
		await client.connect();

		const serverInfo = client.getServerInfo();
		expect(serverInfo).toBeDefined();
		expect(serverInfo?.name).toContain("NmpServer");

		const tools = await client.discoverTools();
		expect(tools.length).toBeGreaterThan(0);
		expect(tools[0].name).toBe("read_logs");
	});

	it("should simulate execution after connection", async () => {
		const client = new NmpClient();
		await client.connect();

		// Mock a 1184-byte Kyber768 array and a dummy WASM Buffer
		const mockServerPublicKey = new Uint8Array(1184);
		const mockWasmPayload = Buffer.from("mock-wasm-binary-data");

		const res = await client.callTool(
			{ name: "read_logs", arguments: {} },
			mockWasmPayload
		);
		expect(res.isError).toBeFalsy();
	});
});
