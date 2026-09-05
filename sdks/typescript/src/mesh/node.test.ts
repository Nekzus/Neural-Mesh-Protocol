// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshNode } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IDENTITY_PATH = path.join(__dirname, "test-identity.json");

describe("MeshNode Identity & Discovery", () => {
	beforeEach(async () => {
		try {
			await fs.unlink(TEST_IDENTITY_PATH);
		} catch (_e) {}
	});

	afterEach(async () => {
		try {
			await fs.unlink(TEST_IDENTITY_PATH);
		} catch (_e) {}
	});

	it("should generate a new identity if none exists", async () => {
		const node = new MeshNode({
			identityPath: TEST_IDENTITY_PATH,
		});

		await node.start();
		const peerId = node.getPeerId();
		expect(peerId).toBeDefined();
		expect(peerId.length).toBeGreaterThan(20);

		const fileExists = await fs
			.access(TEST_IDENTITY_PATH)
			.then(() => true)
			.catch(() => false);
		expect(fileExists).toBe(true);

		await node.stop();
	}, 30000);

	it("should load an existing identity from file", async () => {
		// 1. Generate identity
		const node1 = new MeshNode({ identityPath: TEST_IDENTITY_PATH });
		await node1.start();
		const id1 = node1.getPeerId();
		await node1.stop();

		// 2. Load identity
		const node2 = new MeshNode({ identityPath: TEST_IDENTITY_PATH });
		await node2.start();
		const id2 = node2.getPeerId();
		await node2.stop();

		expect(id2).toBe(id1);
	}, 30000);

	it("should throw error if operations called before start", async () => {
		const node = new MeshNode();
		await expect(node.announceCapability("hash")).rejects.toThrow(
			"Mesh Node is not running",
		);
		await expect(node.findProviders("hash")).rejects.toThrow(
			"Mesh Node is not running",
		);
		await expect(node.resolvePeer("peerId")).rejects.toThrow(
			"Mesh Node is not running",
		);
	});

	it("should resolve local multiaddrs after start", async () => {
		const node = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
		});
		await node.start();

		const addrs = node.getMultiaddrs();
		expect(addrs.length).toBeGreaterThan(0);
		const hasLocal = addrs.some(
			(a) => a.includes("127.0.0.1") || a.includes("::1"),
		);
		expect(hasLocal).toBe(true);

		await node.stop();
	}, 30000);

	it("should provide cryptographic signature using local private key", async () => {
		const node = new MeshNode();
		await node.start();
		const data = Buffer.from("test-data-to-sign");
		const signature = await node.sign(data);

		expect(signature).toBeDefined();
		expect(signature).toBeInstanceOf(Buffer);
		expect(signature.length).toBeGreaterThan(0);

		await node.stop();
	}, 30000);
});
