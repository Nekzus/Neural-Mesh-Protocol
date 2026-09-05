// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Post-Quantum Digital Signature Wrapper
 * Implements ML-DSA-65 (CRYSTALS-Dilithium, NIST FIPS 204) for quantum-resistant
 * manifest attestation, node revocation receipts, and cryptographic integrity.
 *
 * Characteristics:
 * - Security Category: NIST Level 3 (~AES-192 equivalent quantum resistance)
 * - Public Key Length: 1952 bytes
 * - Secret Key Length: 4032 bytes
 * - Signature Length: 3309 bytes
 * - Implementation: Pure TypeScript/JS via @noble/post-quantum
 */

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

export const DILITHIUM65_CONSTANTS = {
	PUBLIC_KEY_BYTES: 1952,
	SECRET_KEY_BYTES: 4032,
	SIGNATURE_BYTES: 3309,
	DEFAULT_CONTEXT: new TextEncoder().encode("LIOP-FIPS204-ML-DSA-65"),
} as const;

/**
 * Deterministically normalizes a message into a Uint8Array.
 */
function normalizeMessage(message: Uint8Array | string): Uint8Array {
	if (typeof message === "string") {
		return new TextEncoder().encode(message);
	}
	return message;
}

/**
 * Deterministic canonical JSON serializer to ensure stable cryptographic hashing
 * regardless of key ordering in JavaScript objects.
 */
function canonicalizeJson(obj: unknown): string {
	if (obj === null || typeof obj !== "object") {
		return JSON.stringify(obj);
	}
	if (Array.isArray(obj)) {
		return `[${obj.map(canonicalizeJson).join(",")}]`;
	}
	const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
	const entries = sortedKeys.map(
		(key) =>
			`${JSON.stringify(key)}:${canonicalizeJson((obj as Record<string, unknown>)[key])}`,
	);
	return `{${entries.join(",")}}`;
}

export const Dilithium65Wrapper = {
	/** Constants */
	PUBLIC_KEY_BYTES: DILITHIUM65_CONSTANTS.PUBLIC_KEY_BYTES,
	SECRET_KEY_BYTES: DILITHIUM65_CONSTANTS.SECRET_KEY_BYTES,
	SIGNATURE_BYTES: DILITHIUM65_CONSTANTS.SIGNATURE_BYTES,

	/**
	 * Generates a new ML-DSA-65 (FIPS 204) key pair.
	 * Optionally accepts a 32-byte seed for deterministic key generation.
	 */
	generateKeyPair(seed?: Uint8Array): {
		publicKey: Uint8Array;
		secretKey: Uint8Array;
	} {
		if (seed && seed.length !== 32) {
			throw new Error(
				`ML-DSA-65 seed must be exactly 32 bytes (Received: ${seed.length})`,
			);
		}
		const keys = ml_dsa65.keygen(seed);
		return {
			publicKey: keys.publicKey,
			secretKey: keys.secretKey,
		};
	},

	/**
	 * Validates and imports a raw ML-DSA-65 public key.
	 */
	importPublicKey(buffer: Uint8Array): Uint8Array {
		if (buffer.length !== DILITHIUM65_CONSTANTS.PUBLIC_KEY_BYTES) {
			throw new Error(
				`ML-DSA-65 Public Key must be exactly ${DILITHIUM65_CONSTANTS.PUBLIC_KEY_BYTES} bytes (Received: ${buffer.length})`,
			);
		}
		return buffer;
	},

	/**
	 * Signs a message using the post-quantum secret key.
	 * Supports optional domain separation context (up to 255 bytes).
	 */
	sign(
		message: Uint8Array | string,
		secretKey: Uint8Array,
		context?: Uint8Array,
	): Uint8Array {
		if (secretKey.length !== DILITHIUM65_CONSTANTS.SECRET_KEY_BYTES) {
			throw new Error(
				`ML-DSA-65 Secret Key must be exactly ${DILITHIUM65_CONSTANTS.SECRET_KEY_BYTES} bytes (Received: ${secretKey.length})`,
			);
		}
		const msgBytes = normalizeMessage(message);
		const ctx = context ?? DILITHIUM65_CONSTANTS.DEFAULT_CONTEXT;
		return ml_dsa65.sign(msgBytes, secretKey, { context: ctx });
	},

	/**
	 * Verifies an ML-DSA-65 post-quantum digital signature.
	 */
	verify(
		signature: Uint8Array,
		message: Uint8Array | string,
		publicKey: Uint8Array,
		context?: Uint8Array,
	): boolean {
		if (signature.length !== DILITHIUM65_CONSTANTS.SIGNATURE_BYTES) {
			return false;
		}
		if (publicKey.length !== DILITHIUM65_CONSTANTS.PUBLIC_KEY_BYTES) {
			return false;
		}
		try {
			const msgBytes = normalizeMessage(message);
			const ctx = context ?? DILITHIUM65_CONSTANTS.DEFAULT_CONTEXT;
			return ml_dsa65.verify(signature, msgBytes, publicKey, { context: ctx });
		} catch {
			return false;
		}
	},

	/**
	 * Signs a structured manifest (LiopManifest) using canonical JSON serialization.
	 * Returns base64-encoded signature and public key for transport over gRPC/MCP.
	 */
	signManifest(
		manifest: Record<string, unknown>,
		secretKey: Uint8Array,
		publicKey: Uint8Array,
	): { signature: string; publicKey: string } {
		const { pqcSignature: _sig, pqcPublicKey: _pub, ...unsigned } = manifest;
		const canonicalStr = canonicalizeJson(unsigned);
		const sig = this.sign(canonicalStr, secretKey);
		return {
			signature: Buffer.from(sig).toString("base64"),
			publicKey: Buffer.from(publicKey).toString("base64"),
		};
	},

	/**
	 * Verifies the post-quantum signature of a structured manifest.
	 */
	verifyManifest(
		manifest: Record<string, unknown>,
		signatureBase64: string,
		publicKeyBase64: string,
	): boolean {
		try {
			const sig = Buffer.from(signatureBase64, "base64");
			const pub = Buffer.from(publicKeyBase64, "base64");
			const { pqcSignature: _sig, pqcPublicKey: _pub, ...unsigned } = manifest;
			const canonicalStr = canonicalizeJson(unsigned);
			return this.verify(sig, canonicalStr, pub);
		} catch {
			return false;
		}
	},
};
