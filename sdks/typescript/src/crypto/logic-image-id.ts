// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";

/**
 * Top-level LIOP v1 envelope only. Must NOT use multiline (^/$) mode:
 * proxy logic embeds a full envelope inside JSON strings; `^` per line would
 * incorrectly treat that as the document root and desync ImageID vs the worker.
 */
const TOP_LEVEL_ENVELOPE = /^\s*@LIOP\{[^}]+\}[\r\n]+([\s\S]*?)[\r\n]+@END\s*$/;

export function normalizeLogicSource(logicUtf8: string): string {
	const match = logicUtf8.match(TOP_LEVEL_ENVELOPE);
	if (match?.[1] !== undefined) {
		return match[1].trim();
	}
	return logicUtf8.trim();
}

/** SHA-256 digest of logic bytes (WASM raw; JS UTF-8 after top-level envelope strip). */
export function deriveLogicImageDigest(logicPayload: Uint8Array): Buffer {
	const isWasm = logicPayload[0] === 0x00 && logicPayload[1] === 0x61;
	if (isWasm) {
		return crypto.createHash("sha256").update(logicPayload).digest();
	}
	const text = Buffer.from(logicPayload).toString("utf-8");
	const normalized = normalizeLogicSource(text);
	return crypto
		.createHash("sha256")
		.update(Buffer.from(normalized, "utf-8"))
		.digest();
}
