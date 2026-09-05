// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { Kyber768Wrapper } from "./kyber.js";

describe("Kyber768Wrapper (ML-KEM-768 / FIPS 203)", () => {
	it("should import a valid 1184-byte public key", () => {
		const validKey = new Uint8Array(1184);
		expect(() => Kyber768Wrapper.importPublicKey(validKey)).not.toThrow();
	});

	it("should throw when importing an invalid public key", () => {
		const invalidKey = new Uint8Array(500);
		expect(() => Kyber768Wrapper.importPublicKey(invalidKey)).toThrow(
			"Kyber768 Public Key must be exactly 1184 bytes (Received: 500)",
		);
	});

	it("should throw during encapsulation if key is invalid internally", async () => {
		const invalidKey = new Uint8Array(10);
		await expect(
			Kyber768Wrapper.encapsulateAsymmetric(invalidKey),
		).rejects.toThrow("Failed to perform PQC encapsulation");
	});

	it("should perform full key exchange cycle (generateKeyPair -> encap -> decap)", async () => {
		const { publicKey, secretKey } = await Kyber768Wrapper.generateKeyPair();
		expect(publicKey.length).toBe(1184);
		expect(secretKey.length).toBe(2400);

		const { ciphertext, sharedSecret: ssSender } =
			await Kyber768Wrapper.encapsulateAsymmetric(publicKey);
		expect(ciphertext.length).toBe(1088);
		expect(ssSender.length).toBe(32);

		const ssReceiver = await Kyber768Wrapper.decapsulateSymmetric(
			ciphertext,
			secretKey,
		);
		expect(ssReceiver.length).toBe(32);

		// Both sides must derive the same shared secret
		expect(Buffer.from(ssSender).toString("hex")).toBe(
			Buffer.from(ssReceiver).toString("hex"),
		);
	});
});
