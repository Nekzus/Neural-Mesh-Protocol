import { describe, expect, it } from "vitest";
import { AesGcmWrapper } from "./aes.js";
import { randomBytes } from "node:crypto";

describe("AesGcmWrapper", () => {
	it("should encrypt and decrypt payload successfully from Buffer string", () => {
		const sharedSecret = randomBytes(32);
		const payload = Buffer.from("test payload", "utf-8");
		const { ciphertext, nonce } = AesGcmWrapper.encryptPayload(
			payload,
			sharedSecret,
		);

		const decrypted = AesGcmWrapper.decryptPayload(
			ciphertext,
			nonce,
			sharedSecret,
		);
		expect(decrypted.toString("utf-8")).toBe("test payload");
	});

	it("should encrypt and decrypt payload successfully from Uint8Array", () => {
		const sharedSecret = randomBytes(32);
		const payload = new Uint8Array([1, 2, 3, 4, 5]);
		const { ciphertext, nonce } = AesGcmWrapper.encryptPayload(
			payload,
			sharedSecret,
		);

		const decrypted = AesGcmWrapper.decryptPayload(
			ciphertext,
			nonce,
			sharedSecret,
		);
		expect(new Uint8Array(decrypted)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it("should throw if encrypting with invalid shared secret length", () => {
		const invalidSecret = randomBytes(16);
		const payload = Buffer.from("test payload", "utf-8");
		expect(() => AesGcmWrapper.encryptPayload(payload, invalidSecret)).toThrow(
			"Symmetric Key must be exactly 32 bytes (256 bits).",
		);
	});

	it("should throw if ciphertext buffer is too short (missing auth tag)", () => {
		const sharedSecret = randomBytes(32);
		const invalidCiphertext = Buffer.from("short");
		const nonce = randomBytes(12);

		expect(() =>
			AesGcmWrapper.decryptPayload(invalidCiphertext, nonce, sharedSecret),
		).toThrow("Invalid GCM Ciphertext; missing authentication tag length");
	});

	it("should throw if decryption fails due to modified ciphertext", () => {
		const sharedSecret = randomBytes(32);
		const payload = Buffer.from("test payload", "utf-8");
		const { ciphertext, nonce } = AesGcmWrapper.encryptPayload(
			payload,
			sharedSecret,
		);

		// Flip a bit in the ciphertext to simulate tampering/corruption
		ciphertext[0] ^= 1;

		expect(() =>
			AesGcmWrapper.decryptPayload(ciphertext, nonce, sharedSecret),
		).toThrow();
	});
});
