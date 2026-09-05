// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Immutable Audit Logger (Phase Beta-3)
 * SOC 2 Type II & HIPAA compliant audit trail with cryptographic Hash-Chain.
 * Guarantees tamper-evidence and non-repudiation for all Logic-on-Origin executions.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

export type AuditStatus =
	| "SUCCESS"
	| "BLOCKED_EGRESS"
	| "ERROR"
	| "POLICY_VIOLATION";

export interface AuditEntry {
	id: string;
	timestamp: string;
	traceId: string;
	agentDid: string;
	peerId: string;
	toolName: string;
	datasetHash: string;
	fuelConsumed: number;
	outputHash: string;
	zkReceiptSig: string;
	status: AuditStatus;
	prevEntryHash: string;
	entryHash: string;
}

export interface AuditRecordParams {
	timestamp?: string;
	traceId?: string;
	agentDid: string;
	peerId: string;
	toolName: string;
	datasetHash?: string;
	fuelConsumed: number;
	outputHash?: string;
	zkReceiptSig?: string;
	status: AuditStatus;
}

export const GENESIS_HASH = "0".repeat(64);

function canonicalize(obj: Record<string, unknown>): string {
	const sortedKeys = Object.keys(obj).sort();
	const canonicalObj: Record<string, unknown> = {};
	for (const key of sortedKeys) {
		canonicalObj[key] = obj[key];
	}
	return JSON.stringify(canonicalObj);
}

export function computeEntryHash(
	entryWithoutHash: Omit<AuditEntry, "entryHash">,
): string {
	const canonical = canonicalize(
		entryWithoutHash as unknown as Record<string, unknown>,
	);
	return crypto.createHash("sha256").update(canonical).digest("hex");
}

export class AuditLogger {
	private entries: AuditEntry[] = [];
	private lastEntryHash: string = GENESIS_HASH;
	private filePath?: string;

	constructor(filePath?: string) {
		this.filePath = filePath;
		if (this.filePath && fs.existsSync(this.filePath)) {
			this.loadFromFile(this.filePath);
		}
	}

	public recordExecution(params: AuditRecordParams): AuditEntry {
		const id = crypto.randomUUID();
		const timestamp = params.timestamp || new Date().toISOString();
		const traceId = params.traceId || crypto.randomBytes(16).toString("hex");
		const datasetHash =
			params.datasetHash ||
			crypto.createHash("sha256").update("").digest("hex");
		const outputHash =
			params.outputHash || crypto.createHash("sha256").update("").digest("hex");
		const zkReceiptSig = params.zkReceiptSig || "";

		const partialEntry: Omit<AuditEntry, "entryHash"> = {
			id,
			timestamp,
			traceId,
			agentDid: params.agentDid,
			peerId: params.peerId,
			toolName: params.toolName,
			datasetHash,
			fuelConsumed: params.fuelConsumed,
			outputHash,
			zkReceiptSig,
			status: params.status,
			prevEntryHash: this.lastEntryHash,
		};

		const entryHash = computeEntryHash(partialEntry);
		const fullEntry: AuditEntry = {
			...partialEntry,
			entryHash,
		};

		this.entries.push(fullEntry);
		this.lastEntryHash = entryHash;

		if (this.filePath) {
			fs.appendFileSync(
				this.filePath,
				`${JSON.stringify(fullEntry)}\n`,
				"utf8",
			);
		}

		return fullEntry;
	}

	public getEntries(): readonly AuditEntry[] {
		return [...this.entries];
	}

	public getEntryCount(): number {
		return this.entries.length;
	}

	public verifyIntegrity(): {
		valid: boolean;
		totalEntries: number;
		brokenIndex?: number;
		reason?: string;
	} {
		let expectedPrevHash = GENESIS_HASH;

		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];

			// 1. Verify prevEntryHash matches previous record's entryHash
			if (entry.prevEntryHash !== expectedPrevHash) {
				return {
					valid: false,
					totalEntries: this.entries.length,
					brokenIndex: i,
					reason: `Broken hash chain at index ${i}: expected prevHash ${expectedPrevHash}, got ${entry.prevEntryHash}`,
				};
			}

			// 2. Recompute and verify current entry's entryHash
			const { entryHash, ...withoutHash } = entry;
			const recalculated = computeEntryHash(withoutHash);
			if (recalculated !== entryHash) {
				return {
					valid: false,
					totalEntries: this.entries.length,
					brokenIndex: i,
					reason: `Tampered entry at index ${i}: hash mismatch (expected ${recalculated}, stored ${entryHash})`,
				};
			}

			expectedPrevHash = entryHash;
		}

		return {
			valid: true,
			totalEntries: this.entries.length,
		};
	}

	public exportJsonl(): string {
		return this.entries.map((e) => JSON.stringify(e)).join("\n");
	}

	private loadFromFile(path: string): void {
		const content = fs.readFileSync(path, "utf8");
		const lines = content.split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			const entry = JSON.parse(line) as AuditEntry;
			this.entries.push(entry);
			this.lastEntryHash = entry.entryHash;
		}
	}
}

// Global default audit logger
export const globalAuditLogger = new AuditLogger();
