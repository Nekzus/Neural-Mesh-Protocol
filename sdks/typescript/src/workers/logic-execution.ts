// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { createMlKem768 } from "mlkem";
import {
	deriveLogicImageDigest,
	normalizeLogicSource,
} from "../crypto/logic-image-id.js";
import { ASTGuardian } from "../sandbox/guardian.js";
import { WasiSandbox } from "../sandbox/wasi.js";
import { applyDpToOutput } from "../security/dp-engine.js";
import { sanitizeOutput } from "../server/output-sanitizer.js";

export interface WorkerData {
	isWarmup?: boolean;
	ciphertext?: Uint8Array;
	secretKeyObj?: ArrayLike<number>;
	kyberPublicKey?: Uint8Array;
	wasmBinary?: Uint8Array; // Can also be JS code in non-encrypted mode
	inputs?: Record<string, Uint8Array>;
	records?: Record<string, unknown>[];
	sessionToken?: string;
	sessionTimestamp?: number;
	isEncrypted?: boolean;
	aesNonce?: Uint8Array;
	dpConfig?: {
		epsilon: number;
		sensitivity: number;
		smallDatasetThreshold: number;
	};
}

export default async function processLogicExecution(data: WorkerData): Promise<{
	image_id: string;
	output: unknown;
	fuel_consumed: number;
	zk_receipt?: string;
}> {
	// Freeze Host prototypes in the Worker thread proactively to completely lock down the Isolate environment
	if (
		typeof Object.prototype === "object" &&
		!Object.isFrozen(Object.prototype)
	) {
		Object.freeze(Object.prototype);
		Object.freeze(Array.prototype);
		Object.freeze(String.prototype);
		Object.freeze(Number.prototype);
		Object.freeze(Boolean.prototype);
		Object.freeze(RegExp.prototype);
		Object.freeze(Map.prototype);
		Object.freeze(Set.prototype);
		Object.freeze(Promise.prototype);
		Object.freeze(Error.prototype);
	}

	if (data.isWarmup) {
		return {
			image_id: "",
			output: "warm",
			fuel_consumed: 0,
		};
	}

	// [PQC Security] Enforce Strict 1-Hour Session Lifetime (NIST SP 800-53 / PCI-DSS)
	if (data.sessionTimestamp !== undefined) {
		const MAX_SESSION_KEY_LIFETIME_MS = 3600 * 1000; // 3600 seconds
		const age = Date.now() - data.sessionTimestamp;
		if (age > MAX_SESSION_KEY_LIFETIME_MS) {
			throw new Error(
				`[LIOP-PQC] Session secret expired: Age (${Math.round(age / 1000)}s) exceeds 3600s TTL limit.`,
			);
		}
		if (data.sessionTimestamp > Date.now() + 60000) {
			throw new Error(
				"[LIOP-PQC] Session secret invalid: Timestamp is in the future.",
			);
		}
	}

	const {
		ciphertext,
		secretKeyObj,
		wasmBinary,
		inputs,
		aesNonce,
		records,
		isEncrypted = true,
		dpConfig,
	} = data as Required<WorkerData>;

	let decryptedPayload: Buffer | string;
	const decryptedInputs: Record<string, unknown> = {};
	let sessionSecret = Buffer.alloc(32); // Fallback if plain text (no PQC)

	if (isEncrypted) {
		// 1. Decapsulate Kyber secret
		const sk = new Uint8Array(secretKeyObj);
		const ct = new Uint8Array(ciphertext);
		const kem = await createMlKem768();
		const sharedSecret = kem.decap(ct, sk);
		const aesKey = Buffer.from(sharedSecret);
		sessionSecret = aesKey;

		// 2. Decrypt Main Payload (WASM/JS Code)
		// LIOP Serialization: Ciphertext = EncryptedData + 16-byte AuthTag
		const wasmBuffer = Buffer.from(wasmBinary);
		const authTag = wasmBuffer.subarray(-16);
		const encryptedData = wasmBuffer.subarray(0, -16);

		const decipher = crypto.createDecipheriv(
			"aes-256-gcm",
			aesKey,
			Buffer.from(aesNonce || new Uint8Array(12)),
		);
		decipher.setAuthTag(authTag);
		let decrypted = decipher.update(encryptedData);
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		decryptedPayload = decrypted;

		// 3. Decrypt Inputs
		for (const [key, encValue] of Object.entries(inputs || {})) {
			const valBuffer = Buffer.from(encValue);
			// Extract 12-byte prepended nonce, ciphertext, and 16-byte AuthTag
			const inputNonce = valBuffer.subarray(0, 12);
			const valTag = valBuffer.subarray(-16);
			const valData = valBuffer.subarray(12, -16);

			const valDecipher = crypto.createDecipheriv(
				"aes-256-gcm",
				aesKey,
				inputNonce,
			);
			valDecipher.setAuthTag(valTag);
			let valDecrypted = valDecipher.update(valData);
			valDecrypted = Buffer.concat([valDecrypted, valDecipher.final()]);
			decryptedInputs[key] = JSON.parse(valDecrypted.toString("utf-8"));
		}
	} else {
		// Transparent mode: payload is provided directly
		// If it's WASM (Magic bytes: \0asm), keep as Buffer
		if (
			wasmBinary[0] === 0x00 &&
			wasmBinary[1] === 0x61 &&
			wasmBinary[2] === 0x73 &&
			wasmBinary[3] === 0x6d
		) {
			decryptedPayload = Buffer.from(wasmBinary);
		} else {
			decryptedPayload = Buffer.from(wasmBinary).toString("utf-8");
		}
	}

	// 3. Inspect AST with Guardian-TS (if WASM)
	const isWasm =
		decryptedPayload[0] === 0x00 &&
		decryptedPayload[1] === 0x61 &&
		decryptedPayload[2] === 0x73 &&
		decryptedPayload[3] === 0x6d;

	if (decryptedPayload instanceof Buffer && isWasm) {
		// Ensure we pass a compatible BufferSource
		const wasmBytes = new Uint8Array(decryptedPayload);
		const compiledModule = await WebAssembly.compile(wasmBytes);
		ASTGuardian.analyze(compiledModule);
	} else if (decryptedPayload instanceof Buffer && !isWasm) {
		decryptedPayload = decryptedPayload.toString("utf-8");
	}

	// Strip only a whole-document LIOP envelope (see logic-image-id.ts).
	if (typeof decryptedPayload === "string") {
		decryptedPayload = normalizeLogicSource(decryptedPayload);
	}

	// 4. Instantiate and Execute WASI Sandbox (or V8 Fallback)
	const sandbox = new WasiSandbox();
	await sandbox.init();

	try {
		const result = await sandbox.execute(
			decryptedPayload,
			records,
			decryptedInputs,
		);

		let finalOutput = result.output;

		// Pre-compute Image ID and Dataset Hash for Audit Trail & DP Seeding
		let logicBytes: Uint8Array;
		if (typeof decryptedPayload === "string") {
			logicBytes = Buffer.from(decryptedPayload, "utf-8");
		} else {
			logicBytes = new Uint8Array(decryptedPayload);
		}
		const imageId = deriveLogicImageDigest(logicBytes).toString("hex");

		// Phase 110: Include dataset_hash for SOX audit trail compliance.
		// This SHA-256 anchor proves the underlying dataset was identical
		// across consecutive queries, separating DP noise from data mutation.
		const datasetHash = crypto
			.createHash("sha256")
			.update(JSON.stringify(records || []))
			.digest("hex");

		// Apply Differential Privacy before committing to the ZK-Receipt
		if (dpConfig) {
			finalOutput = applyDpToOutput(
				finalOutput,
				{
					...dpConfig,
					seed: `${datasetHash}:${imageId}`,
				},
				records?.length || 0,
			);
		}

		// Apply Output Sanitizer before commitment to guarantee ZK output consistency
		finalOutput = sanitizeOutput(finalOutput);

		// 5. Generate Cryptographic Proof of Execution (HMAC-SHA256 Commitment)

		const journal = Buffer.from(
			JSON.stringify({
				image_id: imageId,
				dataset_hash: datasetHash,
				output_hash: crypto
					.createHash("sha256")
					.update(
						typeof finalOutput === "string"
							? finalOutput
							: finalOutput === undefined
								? "undefined"
								: JSON.stringify(finalOutput),
					)
					.digest("hex"),
				fuel: result.fuelConsumed,
				ts: Date.now(),
			}),
		);

		const seal = crypto
			.createHmac("sha256", sessionSecret)
			.update(journal)
			.digest();
		const journalLen = Buffer.alloc(2);
		journalLen.writeUInt16BE(journal.length);
		const receiptBuf = Buffer.concat([
			Buffer.from([0x01]), // Receipt format v1
			journalLen,
			journal,
			seal, // 32 bytes HMAC
		]);
		const zkReceipt = receiptBuf.toString("base64");

		return {
			image_id: imageId,
			zk_receipt: zkReceipt,
			output: finalOutput,
			fuel_consumed: result.fuelConsumed,
		};
	} finally {
		await sandbox.teardown();
	}
}
