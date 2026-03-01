/// <reference path="../../types/crystals-kyber.d.ts" />
import * as kyber from "crystals-kyber";
import { randomBytes } from "node:crypto";

/**
 * NMP Post-Quantum Cryptography Wrapper
 * Implements ML-KEM-768 for Zero-Trust secure key encapsulation
 * directly compatible with `pqcrypto-kyber` on the Mesh-Node Backend.
 */

export class Kyber768Wrapper {
	/**
	 * Extracts and validates the 1184-byte Public Key from the Rust NMP Data Node
	 * @param buffer Raw buffer sent via gRPC IntentResponse
	 */
	static importPublicKey(buffer: Uint8Array): Uint8Array {
		if (buffer.length !== 1184) {
			throw new Error(
				`Kyber768 Public Key must be exactly 1184 bytes (Received: ${buffer.length})`,
			);
		}
		return buffer;
	}

	/**
	 * Encapsulates a shared secret using the server's public key.
	 * Returns the 1088-byte ciphertext to be sent back, and the 32-byte shared AES secret.
	 */
	static encapsulateAsymmetric(publicKey: Uint8Array): {
		ciphertext: Uint8Array;
		sharedSecret: Uint8Array;
	} {
		try {
			if (publicKey.length !== 1184) {
				throw new Error("Kyber768 Public Key must be exactly 1184 bytes.");
			}

			// Encapsulate the shared secret using ML-KEM-768
			const result = kyber.Encrypt768(publicKey);

			if (!result || !result[0] || !result[1]) {
				throw new Error("Invalid key encapsulation result from engine.");
			}

			return {
				ciphertext: new Uint8Array(result[0]), // Ciphertext to send via network
				sharedSecret: new Uint8Array(result[1]), // AES-GCM 256-bit symmetric key
			};
		} catch (error) {
			throw new Error(
				`Failed to perform PQC encapsulation: ${(error as Error).message}`,
			);
		}
	}
}
