// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/// <reference types="node" />

import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { LiopClient } from "./index.js";

describe("LiopClient", () => {
	it("should throw an error if attempting to execute without connection", async () => {
		const client = new LiopClient();

		const _mockServerPublicKey = new Uint8Array(1184);
		const mockWasmPayload = Buffer.from("mock");

		await expect(
			client.callTool({ name: "any" }, mockWasmPayload),
		).rejects.toThrow("Client must be connected before calling tools.");
		await expect(client.discoverTools()).rejects.toThrow(
			"Client must be connected before discovering tools.",
		);
	});

	it("should successfully connect and mock capability discovery", async () => {
		const client = new LiopClient();
		await client.connect();

		const serverInfo = client.getServerInfo();
		expect(serverInfo).toBeDefined();
		expect(serverInfo?.name).toContain("LiopServer");

		const tools = await client.discoverTools();
		expect(tools).toBeInstanceOf(Array);
	});

	it("should reject callTool when no gRPC server is reachable", async () => {
		const client = new LiopClient();
		await client.connect();

		// Mock a 1184-byte Kyber768 array and a dummy WASM Buffer
		const mockWasmPayload = Buffer.from("mock-wasm-binary-data");

		// callTool should reject because there is no gRPC server running at localhost:50051
		await expect(
			client.callTool({ name: "read_logs", arguments: {} }, mockWasmPayload),
		).rejects.toThrow();
	});

	it("should return resource contents via dynamic DHT discovery", async () => {
		const client = new LiopClient();
		await client.connect();

		// Access the private meshNode instance for mocking
		// biome-ignore lint/suspicious/noExplicitAny: testing internals
		const meshNode = (client as any).meshNode;

		vi.spyOn(meshNode, "findProviders").mockResolvedValue(["peer-123"]);
		vi.spyOn(meshNode, "queryManifest").mockResolvedValue({
			peerId: "peer-123",
			grpcPort: 3000,
			tools: [],
			serverInfo: { name: "test", version: "1" },
			resources: [
				{
					uri: "liop://test/resource",
					name: "test-res",
					mimeType: "application/json",
					text: "null",
				},
			],
		});

		const result = await client.readResource("liop://test/resource");
		expect(result).toBeDefined();
		expect(result.contents[0].uri).toBe("liop://test/resource");
		expect(result.contents[0].mimeType).toBe("application/json");
		expect(result.contents[0].text).toContain("liop://test/resource");
	});
});
