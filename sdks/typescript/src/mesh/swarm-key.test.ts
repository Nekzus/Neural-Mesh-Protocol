// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { multiaddr } from "@multiformats/multiaddr";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshNode } from "./node.js";
import {
	createSwarmKey,
	deserializeSwarmKey,
	loadSwarmKey,
	parseSwarmKey,
	SWARM_KEY_BYTE_LENGTH,
	saveSwarmKey,
	serializeSwarmKey,
} from "./swarm-key.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_SWARM_FILE = path.join(__dirname, "test-swarm.key");

describe("Swarm Key & Tier 1 Enclave Isolation (pnet PSK)", () => {
	beforeEach(async () => {
		try {
			await fs.unlink(TEST_SWARM_FILE);
		} catch (_e) {}
	});

	afterEach(async () => {
		try {
			await fs.unlink(TEST_SWARM_FILE);
		} catch (_e) {}
	});

	it("should generate a valid 95-byte PSK following libp2p canonical format", () => {
		const psk = createSwarmKey();
		expect(psk).toBeInstanceOf(Uint8Array);
		expect(psk.length).toBe(SWARM_KEY_BYTE_LENGTH);

		const text = new TextDecoder().decode(psk);
		expect(text).toContain("/key/swarm/psk/1.0.0/");
		expect(text).toContain("/base16/");
	});

	it("should serialize to and deserialize from Base64 deterministically", () => {
		const pskOriginal = createSwarmKey();
		const base64 = serializeSwarmKey(pskOriginal);
		expect(typeof base64).toBe("string");
		expect(base64.length).toBeGreaterThan(50);

		const pskRestored = deserializeSwarmKey(base64);
		expect(pskRestored.length).toBe(SWARM_KEY_BYTE_LENGTH);
		expect(Buffer.from(pskRestored).equals(Buffer.from(pskOriginal))).toBe(
			true,
		);
	});

	it("should parse both multiline canonical text and Base64 format", () => {
		const pskOriginal = createSwarmKey();
		const text = new TextDecoder().decode(pskOriginal);
		const base64 = serializeSwarmKey(pskOriginal);

		const parsedFromText = parseSwarmKey(text);
		expect(parsedFromText.length).toBe(SWARM_KEY_BYTE_LENGTH);
		expect(Buffer.from(parsedFromText).equals(Buffer.from(pskOriginal))).toBe(
			true,
		);

		const parsedFromBase64 = parseSwarmKey(base64);
		expect(parsedFromBase64.length).toBe(SWARM_KEY_BYTE_LENGTH);
		expect(Buffer.from(parsedFromBase64).equals(Buffer.from(pskOriginal))).toBe(
			true,
		);
	});

	it("should save and load Swarm Key to/from filesystem", async () => {
		const pskOriginal = createSwarmKey();
		await saveSwarmKey(pskOriginal, TEST_SWARM_FILE);

		const fileExists = await fs
			.access(TEST_SWARM_FILE)
			.then(() => true)
			.catch(() => false);
		expect(fileExists).toBe(true);

		const pskLoaded = await loadSwarmKey(TEST_SWARM_FILE);
		expect(pskLoaded.length).toBe(SWARM_KEY_BYTE_LENGTH);
		expect(Buffer.from(pskLoaded).equals(Buffer.from(pskOriginal))).toBe(true);
	});

	it("should correctly report isPrivateNetwork and getSwarmKey on MeshNode", async () => {
		const psk = createSwarmKey();
		const nodePrivate = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
			swarmKey: psk,
		});

		const nodePublic = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
		});

		expect(nodePrivate.isPrivateNetwork()).toBe(true);
		expect(nodePrivate.getSwarmKey()).toBe(psk);

		expect(nodePublic.isPrivateNetwork()).toBe(false);
		expect(nodePublic.getSwarmKey()).toBeUndefined();
	});

	it("should allow two nodes with the SAME PSK to connect and communicate", async () => {
		const sharedPsk = createSwarmKey();

		const nodeA = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
			swarmKey: sharedPsk,
		});

		await nodeA.start();
		const addrsA = nodeA.getMultiaddrs();
		const tcpAddrA = addrsA.find(
			(a) => a.includes("/tcp/") && !a.includes("/ws"),
		);
		expect(tcpAddrA).toBeDefined();

		const nodeB = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
			bootstrapNodes: [tcpAddrA as string],
			swarmKey: sharedPsk,
		});

		await nodeB.start();

		// Wait briefly for connection handshake with shared PSK
		let connected = false;
		for (let i = 0; i < 20; i++) {
			const peersB = nodeB.getPeers();
			if (peersB.length > 0) {
				connected = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 150));
		}

		expect(connected).toBe(true);

		await nodeB.stop();
		await nodeA.stop();
	}, 30000);

	it("should REJECT connection from a node WITHOUT PSK or with DIFFERENT PSK (Fail-Closed)", async () => {
		const enclavePsk = createSwarmKey();
		const foreignPsk = createSwarmKey();

		// Node Enclave protected by PSK
		const enclaveNode = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
			swarmKey: enclavePsk,
		});

		await enclaveNode.start();
		const addrsEnclave = enclaveNode.getMultiaddrs();
		const tcpAddrEnclave = addrsEnclave.find(
			(a) => a.includes("/tcp/") && !a.includes("/ws"),
		);
		expect(tcpAddrEnclave).toBeDefined();

		// Node Intruder with different PSK (no auto-dial in bootstrap to avoid 30s hang)
		const intruderNode = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
			swarmKey: foreignPsk, // Mismatched PSK!
		});

		await intruderNode.start();

		// Attempting to dial Enclave node MUST fail or abort (pnet framing mismatch)
		let dialFailed = false;
		try {
			// biome-ignore lint/suspicious/noExplicitAny: access internal libp2p node
			await (intruderNode as any).node?.dial(
				multiaddr(tcpAddrEnclave as string),
				{
					signal: AbortSignal.timeout(3000),
				},
			);
		} catch {
			dialFailed = true;
		}
		expect(dialFailed).toBe(true);

		const peersIntruder = intruderNode.getPeers();
		const peersEnclave = enclaveNode.getPeers();

		// Connection MUST be 0 (rejected at pnet framing layer before Noise)
		expect(peersIntruder.length).toBe(0);
		expect(peersEnclave.length).toBe(0);

		await intruderNode.stop();
		await enclaveNode.stop();
	}, 15000);
});
