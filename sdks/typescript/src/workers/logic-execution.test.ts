import { describe, expect, it } from "vitest";
import kyber from "crystals-kyber";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import processLogicExecution from "./logic-execution.js";

describe("WorkerPool: logic-execution PQC & Sandbox", () => {
    it("should execute a transparent plaintext Javascript payload (isEncrypted: false)", async () => {
        const payload = Buffer.from(`
			function nmp_main(env) {
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
            records: [{ name: "Test Patient", condition: "Healthy" }, { name: "John", condition: "Hypertension" }],
            sessionToken: "test-token",
            isEncrypted: false
        });

        expect(response).toBeDefined();
        expect(response.image_id).toBeDefined();
        expect(response.output).toContain("count");
        expect(response.output).toContain("2");
    });

    it("should decrypt and execute a Post-Quantum Encapsulated Payload (isEncrypted: true)", async () => {
        // 1. Generate PQC Keys exactly like the actual handshake
        const pk_sk = kyber.KeyGen768();
        const pk = pk_sk[0];
        const sk = pk_sk[1];

        const c_ss = kyber.Encrypt768(pk);
        const ciphertext = c_ss[0];
        const sharedSecret = c_ss[1]; // Client's symmetric shared secret

        // 2. Client AES Encrypts the payload with the PQC shared secret
        const aesKey = Buffer.from(sharedSecret).subarray(0, 32);
        const payloadContent = Buffer.from(`
			function nmp_main() {
				return JSON.stringify({ msg: "Secure payload decrypted successfully!" });
			}
		`);

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
        let encryptedPayload = cipher.update(payloadContent);
        encryptedPayload = Buffer.concat([encryptedPayload, cipher.final()]);
        const authTag = cipher.getAuthTag();

        const payloadArray = Buffer.concat([iv, authTag, encryptedPayload]);

        // 3. Dispatch to Logic Execution Worker
        const response = await processLogicExecution({
            ciphertext: new Uint8Array(ciphertext),
            secretKeyObj: Array.from(new Uint8Array(sk)),
            kyberPublicKey: new Uint8Array(pk),
            wasmBinary: payloadArray,
            inputs: {},
            records: [],
            sessionToken: "secure-token",
            isEncrypted: true
        });

        // 4. Validate successful Zero-Trust Decryption & Sandbox Execution
        expect(response).toBeDefined();
        expect(response.output).toContain("Secure payload decrypted successfully!");
    });

    it("should fail gracefully if AES-GCM Authentication Tag is tampered", async () => {
        const pk_sk = kyber.KeyGen768();
        const c_ss = kyber.Encrypt768(pk_sk[0]);
        const aesKey = Buffer.from(c_ss[1]).subarray(0, 32);

        const payloadContent = Buffer.from(`
			function nmp_main() {
				return "I will not run";
			}
		`);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
        let encryptedPayload = cipher.update(payloadContent);
        encryptedPayload = Buffer.concat([encryptedPayload, cipher.final()]);

        // Corrupt the AUth Tag to simulate tampering
        const corruptedAuthTag = cipher.getAuthTag();
        corruptedAuthTag[0] ^= 0xff;

        const payloadArray = Buffer.concat([iv, corruptedAuthTag, encryptedPayload]);

        await expect(
            processLogicExecution({
                ciphertext: new Uint8Array(c_ss[0]),
                secretKeyObj: Array.from(new Uint8Array(pk_sk[1])),
                kyberPublicKey: new Uint8Array(pk_sk[0]),
                wasmBinary: payloadArray,
                inputs: {},
                records: [],
                sessionToken: "tampered-token",
                isEncrypted: true
            })
        ).rejects.toThrowError("Unsupported state or unable to authenticate data");
    });
});
