import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateKey } from "@libp2p/pnet";

export const SWARM_KEY_BYTE_LENGTH = 95;

/**
 * Creates a freshly generated 95-byte Pre-Shared Key (PSK) for libp2p Private Networks (pnet).
 * Follows the canonical format `/key/swarm/psk/1.0.0/\n/base16/\n<hex>\n`.
 */
export function createSwarmKey(): Uint8Array {
	const psk = new Uint8Array(SWARM_KEY_BYTE_LENGTH);
	generateKey(psk);
	return psk;
}

/**
 * Serializes a 95-byte PSK into a Base64 string for safe environment variable passing or JSON config.
 */
export function serializeSwarmKey(psk: Uint8Array): string {
	if (psk.length !== SWARM_KEY_BYTE_LENGTH) {
		throw new Error(
			`Invalid Swarm Key length: expected ${SWARM_KEY_BYTE_LENGTH} bytes, got ${psk.length}`,
		);
	}
	return Buffer.from(psk).toString("base64");
}

/**
 * Deserializes a Base64-encoded string into a 95-byte PSK Uint8Array.
 */
export function deserializeSwarmKey(base64Str: string): Uint8Array {
	const trimmed = base64Str.trim();
	const buf = Buffer.from(trimmed, "base64");
	if (buf.length !== SWARM_KEY_BYTE_LENGTH) {
		throw new Error(
			`Invalid deserialized Swarm Key: expected ${SWARM_KEY_BYTE_LENGTH} bytes, got ${buf.length}`,
		);
	}
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Parses raw text format PSK or Base64 string into a 95-byte PSK Uint8Array.
 * Allows loading either the canonical multiline text (`/key/swarm/psk/1.0.0/...`) or Base64.
 */
export function parseSwarmKey(rawText: string): Uint8Array {
	const trimmed = rawText.trim();
	// Check if this is canonical raw text format
	if (trimmed.startsWith("/key/swarm/psk/")) {
		const normalized = trimmed.replace(/\r\n/g, "\n").trimEnd();
		const bytes = new TextEncoder().encode(normalized);
		if (bytes.length === SWARM_KEY_BYTE_LENGTH) {
			return bytes;
		}
	}
	// Fallback to Base64 deserialization
	return deserializeSwarmKey(trimmed);
}

/**
 * Saves a 95-byte Swarm Key to a file on disk (written as canonical text).
 */
export async function saveSwarmKey(
	psk: Uint8Array,
	filePath: string,
): Promise<void> {
	if (psk.length !== SWARM_KEY_BYTE_LENGTH) {
		throw new Error(
			`Cannot save invalid Swarm Key: expected ${SWARM_KEY_BYTE_LENGTH} bytes, got ${psk.length}`,
		);
	}
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, psk);
}

/**
 * Loads a 95-byte Swarm Key from a file on disk.
 * Supports both raw binary/canonical format and Base64-encoded text.
 */
export async function loadSwarmKey(filePath: string): Promise<Uint8Array> {
	const fileBuffer = await readFile(filePath);
	if (fileBuffer.length === SWARM_KEY_BYTE_LENGTH) {
		return new Uint8Array(
			fileBuffer.buffer,
			fileBuffer.byteOffset,
			fileBuffer.byteLength,
		);
	}
	const text = fileBuffer.toString("utf-8");
	return parseSwarmKey(text);
}
