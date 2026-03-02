import { describe, expect, it } from "vitest";
import { Kyber768Wrapper } from "./kyber.js";

describe("Kyber768Wrapper", () => {
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

	it("should throw during encapsulation if key is invalid internally", () => {
		const invalidKey = new Uint8Array(10);
		expect(() => Kyber768Wrapper.encapsulateAsymmetric(invalidKey)).toThrow(
			"Failed to perform PQC encapsulation",
		);
	});
});
