// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from "node:buffer";

import { createMlKem768 } from "mlkem";
import { describe, expect, it } from "vitest";
import { AesGcmWrapper } from "../rpc/crypto/aes.js";
import processLogicExecution from "./logic-execution.js";

describe("WorkerPool: logic-execution PQC & Sandbox", () => {
	it("should execute a transparent plaintext Javascript payload (isEncrypted: false)", async () => {
		const payload = Buffer.from(`
			function liop_main(env) {
				const result = env.records ? env.records.length : 0;
				return JSON.stringify({ count: result });
			}
		`);

		const response = await processLogicExecution({
			ciphertext: new Uint8Array(0),
			secretKeyObj: Array.from(new Uint8Array(0)),
			kyberPublicKey: new Uint8Array(0),
			wasmBinary: payload,
			inputs: {},
			records: [
				{ name: "Test Patient", condition: "Healthy" },
				{ name: "John", condition: "Hypertension" },
			],
			sessionToken: "test-token",
			isEncrypted: false,
		});

		expect(response).toBeDefined();
		expect(response.image_id).toBeDefined();
		expect(response.output).toContain("count");
		expect(response.output).toContain("2");
	});

	it("should decrypt and execute a Post-Quantum Encapsulated Payload (isEncrypted: true)", async () => {
		// 1. Generate PQC Keys using FIPS 203 ML-KEM-768
		const kem = await createMlKem768();
		const [pk, sk] = kem.generateKeyPair();

		const sender = await createMlKem768();
		const [ciphertext, sharedSecret] = sender.encap(pk);

		// 2. Client AES Encrypts the payload with the PQC shared secret
		const payloadContent = Buffer.from(`
			function liop_main() {
				return JSON.stringify({ msg: "Secure payload decrypted successfully!" });
			}
		`);

		const { ciphertext: finalCiphertext, nonce: aesNonce } =
			AesGcmWrapper.encryptPayload(payloadContent, sharedSecret);

		// 3. Dispatch to Logic Execution Worker
		const response = await processLogicExecution({
			ciphertext: new Uint8Array(ciphertext),
			secretKeyObj: Array.from(new Uint8Array(sk)),
			kyberPublicKey: new Uint8Array(pk),
			wasmBinary: finalCiphertext,
			aesNonce,
			inputs: {},
			records: [],
			sessionToken: "secure-token",
			isEncrypted: true,
		});

		// 4. Validate successful Zero-Trust Decryption & Sandbox Execution
		expect(response).toBeDefined();
		expect(response.output).toContain("Secure payload decrypted successfully!");
	});

	it("should fail gracefully if AES-GCM Authentication Tag is tampered", async () => {
		const kem = await createMlKem768();
		const [pk, sk] = kem.generateKeyPair();

		const sender = await createMlKem768();
		const [ciphertext, sharedSecret] = sender.encap(pk);

		const payloadContent = Buffer.from(`
			function liop_main() {
				return "I will not run";
			}
		`);
		const { ciphertext: finalCiphertext, nonce: aesNonce } =
			AesGcmWrapper.encryptPayload(payloadContent, sharedSecret);

		// Corrupt the Auth Tag (last 16 bytes)
		finalCiphertext[finalCiphertext.length - 1] ^= 0xff;

		await expect(
			processLogicExecution({
				ciphertext: new Uint8Array(ciphertext),
				secretKeyObj: Array.from(new Uint8Array(sk)),
				kyberPublicKey: new Uint8Array(pk),
				wasmBinary: finalCiphertext,
				aesNonce,
				inputs: {},
				records: [],
				sessionToken: "tampered-token",
				isEncrypted: true,
			}),
		).rejects.toThrowError("Unsupported state or unable to authenticate data");
	});
});
