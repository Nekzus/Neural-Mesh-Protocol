// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DILITHIUM65_CONSTANTS, Dilithium65Wrapper } from "./dilithium.js";

describe("Dilithium65Wrapper (ML-DSA-65 / NIST FIPS 204)", () => {
	it("should generate valid keypair conforming to FIPS 204 byte lengths", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		expect(keypair.publicKey.length).toBe(
			DILITHIUM65_CONSTANTS.PUBLIC_KEY_BYTES,
		);
		expect(keypair.secretKey.length).toBe(
			DILITHIUM65_CONSTANTS.SECRET_KEY_BYTES,
		);
	});

	it("should generate deterministic keypair when seed is provided", () => {
		const seed = new Uint8Array(32).fill(42);
		const keypair1 = Dilithium65Wrapper.generateKeyPair(seed);
		const keypair2 = Dilithium65Wrapper.generateKeyPair(seed);

		expect(
			Buffer.from(keypair1.publicKey).equals(Buffer.from(keypair2.publicKey)),
		).toBe(true);
		expect(
			Buffer.from(keypair1.secretKey).equals(Buffer.from(keypair2.secretKey)),
		).toBe(true);
	});

	it("should reject seeds that are not exactly 32 bytes", () => {
		expect(() =>
			Dilithium65Wrapper.generateKeyPair(new Uint8Array(16)),
		).toThrow(/ML-DSA-65 seed must be exactly 32 bytes/);
	});

	it("should successfully sign and verify a text message", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		const message = "LIOP Decentralized Mesh Attestation Message";

		const signature = Dilithium65Wrapper.sign(message, keypair.secretKey);
		expect(signature.length).toBe(DILITHIUM65_CONSTANTS.SIGNATURE_BYTES);

		const isValid = Dilithium65Wrapper.verify(
			signature,
			message,
			keypair.publicKey,
		);
		expect(isValid).toBe(true);
	});

	it("should successfully sign and verify raw Uint8Array binary data", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		const binary = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xee]);

		const signature = Dilithium65Wrapper.sign(binary, keypair.secretKey);
		const isValid = Dilithium65Wrapper.verify(
			signature,
			binary,
			keypair.publicKey,
		);
		expect(isValid).toBe(true);
	});

	it("should reject signatures when message content is tampered", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		const originalMsg = "Execute WASM Kernel on Node Alpha";
		const tamperedMsg = "Execute WASM Kernel on Node Mallory";

		const signature = Dilithium65Wrapper.sign(originalMsg, keypair.secretKey);
		const isValid = Dilithium65Wrapper.verify(
			signature,
			tamperedMsg,
			keypair.publicKey,
		);
		expect(isValid).toBe(false);
	});

	it("should reject signatures when verified against wrong public key", () => {
		const alice = Dilithium65Wrapper.generateKeyPair();
		const bob = Dilithium65Wrapper.generateKeyPair();
		const msg = "Zero-Trust Node Handshake";

		const signature = Dilithium65Wrapper.sign(msg, alice.secretKey);
		const isValid = Dilithium65Wrapper.verify(signature, msg, bob.publicKey);
		expect(isValid).toBe(false);
	});

	it("should sign and verify structured manifests canonically", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		const manifest = {
			nodeId: "liop-vault-01",
			tools: ["aggregate_medical_history"],
			taxonomy: { domain: "healthcare", clearanceTier: 2 },
			version: "2.0.0",
		};

		const { signature, publicKey } = Dilithium65Wrapper.signManifest(
			manifest,
			keypair.secretKey,
			keypair.publicKey,
		);

		expect(typeof signature).toBe("string");
		expect(typeof publicKey).toBe("string");

		const isVerified = Dilithium65Wrapper.verifyManifest(
			manifest,
			signature,
			publicKey,
		);
		expect(isVerified).toBe(true);
	});

	it("should detect tampering in structured manifests", () => {
		const keypair = Dilithium65Wrapper.generateKeyPair();
		const manifest = {
			nodeId: "liop-bank-01",
			tools: ["query_balance"],
		};

		const { signature, publicKey } = Dilithium65Wrapper.signManifest(
			manifest,
			keypair.secretKey,
			keypair.publicKey,
		);

		const tamperedManifest = {
			...manifest,
			tools: ["query_balance", "drain_funds"],
		};

		const isVerified = Dilithium65Wrapper.verifyManifest(
			tamperedManifest,
			signature,
			publicKey,
		);
		expect(isVerified).toBe(false);
	});
});
