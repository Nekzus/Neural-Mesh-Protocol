import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * NMP Symmetric Payload Encryption Wrapper
 * Uses AES-256-GCM to secure WASM Code transport over Zero-Trust networks.
 * Fully compatible with the `aes-gcm` Rust crate used by Wasmtime.
 */
export class AesGcmWrapper {
    /**
     * Encrypts a raw WASM payload using the shared secret negotiated via Kyber768.
     *
     * @param payload Raw incoming WASM byte array or string.
     * @param sharedSecret A perfectly derived 32-byte (256-bit) shared secret array
     * @returns The encrypted buffer to push to the GRPc stream, along with the 12-byte initialization vector natively generated.
     */
    static encryptPayload(
        payload: Uint8Array | Buffer,
        sharedSecret: Uint8Array,
    ): {
        ciphertext: Buffer;
        nonce: Buffer;
    } {
        if (sharedSecret.length !== 32) {
            throw new Error("Symmetric Key must be exactly 32 bytes (256 bits).");
        }

        // NMP standard demands 96-bit (12 byte) IVs/Nonces for AES-GCM
        const nonce = randomBytes(12);

        const cipher = createCipheriv("aes-256-gcm", sharedSecret, nonce);

        // Encrypt the payload and seal the tag
        const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
        const authTag = cipher.getAuthTag(); // 16 bytes for GCM integrity

        // In NMP, the auth tag is strictly appended to the end of the ciphertext bytes
        // mirroring the default serialization logic within `aes_gcm::Aes256Gcm` in Rust
        const finalCiphertext = Buffer.concat([encrypted, authTag]);

        return {
            ciphertext: finalCiphertext,
            nonce: nonce,
        };
    }

    /**
     * Decrypts a remote Zero-Knowledge receipt using AES-256-GCM.
     */
    static decryptPayload(
        ciphertextBuffer: Buffer,
        nonce: Buffer,
        sharedSecret: Uint8Array,
    ): Buffer {
        if (ciphertextBuffer.length < 16) {
            throw new Error("Invalid GCM Ciphertext; missing authentication tag length");
        }

        // The last 16 bytes represent the AuthTag appended by rust-aes-gcm
        const encryptedData = ciphertextBuffer.subarray(0, -16);
        const authTag = ciphertextBuffer.subarray(-16);

        const decipher = createDecipheriv("aes-256-gcm", sharedSecret, nonce);
        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(encryptedData),
            decipher.final(),
        ]);
    }
}
