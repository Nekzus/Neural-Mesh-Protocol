// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import { parentPort } from "node:worker_threads";
import { deriveLogicImageDigest } from "../crypto/logic-image-id.js";

// Ensure this worker is used via Piscina pool
if (!parentPort) {
	// Not fatal in Piscina, but handled appropriately
}

/**
 * ZK Verification Payload Structure.
 * Modeled after RISC Zero & SP1 Receipt formats.
 */
export interface ZkVerificationPayload {
	action: "verify_receipt" | "warmup";
	/** Original logic payload (JS/WASM) sent by client */
	logicPayload?: Uint8Array;
	/** Expected ImageID (SHA-256) of the execution state */
	remoteImageIdHex?: string;
	/** Cbor-encoded or raw buffer containing the execution Receipt (Journal + Seal) */
	zkReceipt?: Uint8Array;
	/** Kyber-derived session secret to verify HMAC signature */
	sessionSecret?: Uint8Array;
	/** The expected output value of the computation for anti-replay/tampering verification */
	expectedOutput?: unknown;
}

function deriveImageId(logicPayload: Uint8Array): Buffer {
	return deriveLogicImageDigest(logicPayload);
}

interface ZkJournal {
	image_id: string;
	dataset_hash: string;
	output_hash: string;
	fuel: number;
	ts: number;
}

function tryExtractProxyOutput(logicPayload: Uint8Array): unknown | null {
	try {
		const logicStr = Buffer.from(logicPayload).toString("utf-8").trim();
		if (!logicStr.includes("__liop_proxy_tool")) {
			return null;
		}

		const firstBraceIdx = logicStr.indexOf("{");
		if (firstBraceIdx === -1) {
			return null;
		}

		let braceCount = 0;
		let inDoubleQuote = false;
		let inSingleQuote = false;
		let inBacktick = false;
		let escaped = false;
		let lastBraceIdx = -1;

		for (let i = firstBraceIdx; i < logicStr.length; i++) {
			const char = logicStr[i];

			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === "\\") {
				escaped = true;
				continue;
			}

			if (char === '"' && !inSingleQuote && !inBacktick) {
				inDoubleQuote = !inDoubleQuote;
				continue;
			}

			if (char === "'" && !inDoubleQuote && !inBacktick) {
				inSingleQuote = !inSingleQuote;
				continue;
			}

			if (char === "`" && !inDoubleQuote && !inSingleQuote) {
				inBacktick = !inBacktick;
				continue;
			}

			if (!inDoubleQuote && !inSingleQuote && !inBacktick) {
				if (char === "{") {
					braceCount++;
				} else if (char === "}") {
					braceCount--;
					if (braceCount === 0) {
						lastBraceIdx = i;
						break;
					}
				}
			}
		}

		if (lastBraceIdx !== -1) {
			const jsonStr = logicStr.slice(firstBraceIdx, lastBraceIdx + 1);
			const parsed = JSON.parse(jsonStr);
			if (parsed?.__liop_proxy_tool) {
				return parsed;
			}
		}
	} catch (_e) {
		// Fallback
	}
	return null;
}

/**
 * Simulates heavy ZK-Proof cryptographic verification.
 * In a real environment, this delegates to @risc0/verifier or SP1 FFI bindings.
 */
async function verifyZkReceipt(
	payload: ZkVerificationPayload,
): Promise<{ verified: boolean; message: string }> {
	const {
		logicPayload,
		remoteImageIdHex,
		zkReceipt,
		sessionSecret,
		expectedOutput,
	} = payload;

	if (!logicPayload || !remoteImageIdHex || !zkReceipt) {
		return {
			verified: false,
			message: "Missing required verification fields.",
		};
	}

	// 1. Calculate local ImageID (Integrity Check)
	const localImageId = deriveImageId(logicPayload);
	const localImageIdHex = localImageId.toString("hex");

	if (localImageIdHex !== remoteImageIdHex) {
		return {
			verified: false,
			message: `Integrity Violation: Local (${localImageIdHex.slice(0, 8)}) != Remote (${remoteImageIdHex.slice(0, 8)})`,
		};
	}

	// 2. Structural Verification: Deserialize Binary Receipt
	const receiptBuf = Buffer.from(zkReceipt);
	if (receiptBuf.length < 35) {
		// 1 version + 2 len + 32 seal minimum
		return {
			verified: false,
			message: "Receipt too short for binary format.",
		};
	}

	const version = receiptBuf[0];
	if (version !== 0x01) {
		return {
			verified: false,
			message: `Unknown receipt version: ${version}`,
		};
	}

	const journalLen = receiptBuf.readUInt16BE(1);
	const journal = receiptBuf.subarray(3, 3 + journalLen);
	const seal = receiptBuf.subarray(3 + journalLen);

	if (seal.length !== 32) {
		return {
			verified: false,
			message: "Invalid seal length (expected 32 bytes HMAC-SHA256).",
		};
	}

	// 3. Parse journal and verify imageId
	let journalData: ZkJournal;
	try {
		journalData = JSON.parse(journal.toString()) as ZkJournal;
		if (journalData.image_id !== localImageIdHex) {
			return {
				verified: false,
				message: `Journal ImageID mismatch: ${journalData.image_id.slice(0, 8)} != ${localImageIdHex.slice(0, 8)}`,
			};
		}
	} catch (_e) {
		return { verified: false, message: "Failed to parse journal data." };
	}

	// 4. Mathematical Verification (HMAC-SHA256)
	if (sessionSecret && sessionSecret.length > 0) {
		const expectedSeal = crypto
			.createHmac("sha256", sessionSecret)
			.update(journal)
			.digest();
		if (!crypto.timingSafeEqual(seal, expectedSeal)) {
			return {
				verified: false,
				message: "Invalid seal: HMAC verification failed.",
			};
		}
	}

	// 5. Output Hash Verification (Anti-Replay / Anti-Tampering)
	if (expectedOutput !== undefined) {
		const proxyOutput = tryExtractProxyOutput(logicPayload);
		const actualExpected = proxyOutput !== null ? proxyOutput : expectedOutput;

		const expectedOutputStr =
			typeof actualExpected === "string"
				? actualExpected
				: actualExpected === undefined
					? "undefined"
					: JSON.stringify(actualExpected);
		const expectedOutputHash = crypto
			.createHash("sha256")
			.update(expectedOutputStr)
			.digest("hex");

		if (journalData.output_hash !== expectedOutputHash) {
			return {
				verified: false,
				message: `Output Hash Mismatch (Replay/Tamper attempt): Journal output_hash (${journalData.output_hash.slice(0, 8)}) != Calculated output_hash (${expectedOutputHash.slice(0, 8)})`,
			};
		}
	}

	return {
		verified: true,
		message: "HMAC Commitment Verified: Integrity intact.",
	};
}

/**
 * Main worker entry point for Piscina.
 */
export default async function workerHandler(
	task: ZkVerificationPayload,
): Promise<{ verified: boolean; message: string }> {
	try {
		if (task.action === "warmup") {
			return {
				verified: true,
				message: "warm",
			};
		}
		if (task.action === "verify_receipt") {
			return await verifyZkReceipt(task);
		}
		throw new Error("Unknown action in ZkVerifier Worker.");
	} catch (error) {
		return {
			verified: false,
			message: `Verification Error: ${(error as Error).message}`,
		};
	}
}
