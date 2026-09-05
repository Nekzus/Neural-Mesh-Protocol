// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Side-Channel Adversarial Test Suite — Phase 108
 *
 * Reproduces the exact attack vectors confirmed exploitable in the
 * Claude Desktop security audit (57 calls, 38 vectors).
 * Tests both the TaintAnalyzer in isolation and integrated in LiopServer.
 */

import { describe, expect, it } from "vitest";
import { TaintAnalyzer } from "./taint-analyzer.js";

const PII_FIELDS = [
	"accountHolder",
	"name",
	"fullName",
	"firstName",
	"lastName",
	"email",
	"phone",
	"ssn",
	"address",
	"id",
];

describe("TaintAnalyzer — Side-Channel Prevention", () => {
	const analyzer = new TaintAnalyzer(PII_FIELDS);

	// ── MUST BLOCK: Direct PII scalar extraction ──────────────────────

	describe("charCodeAt side-channel (MUST BLOCK)", () => {
		it("should block direct charCodeAt(0) on PII field", () => {
			const code = `
				const c0 = env.records[0].accountHolder.charCodeAt(0);
				return { c0 };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
			expect(result?.reason).toContain("PII");
		});

		it("should block charCodeAt via variable intermediary", () => {
			const code = `
				env.records.forEach(r => {
					const name = r.accountHolder;
					const code = name.charCodeAt(0);
				});
				const c0 = env.records[0].accountHolder.charCodeAt(0);
				return { c0 };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block multiple charCodes (c0, c1) in return", () => {
			const code = `
				const c0 = env.records[0].accountHolder.charCodeAt(0);
				const c1 = env.records[0].accountHolder.charCodeAt(1);
				return { c0, c1 };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block charCodeAt inside map callback", () => {
			const code = `
				const codes = env.records.map(r => r.accountHolder.charCodeAt(0));
				return { codes };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});

	describe("Boolean inference side-channel (MUST BLOCK)", () => {
		it("should block ternary conditional derived from charCodeAt", () => {
			const code = `
				const v = env.records[0].accountHolder.charCodeAt(0) < 78 ? 1 : 0;
				return { indicator: v };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block startsWith boolean inference", () => {
			const code = `
				const starts = env.records.map(r => r.name.startsWith('A') ? 1 : 0);
				return { starts };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block includes boolean inference", () => {
			const code = `
				const has = env.records.some(r => r.email.includes('@gmail'));
				return { hasGmail: has ? 1 : 0 };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});

	describe("Hash/accumulative PII derivation (MUST BLOCK)", () => {
		it("should block reduce-based charCode hash", () => {
			const code = `
				const obfuscated = env.records.map(r => {
					const h = r.accountHolder.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
					return { nameHash: h };
				});
				return { data: obfuscated };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block PII string length extraction", () => {
			const code = `
				const lengths = env.records.map(r => r.accountHolder.length);
				return { nameLengths: lengths };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block average PII string length", () => {
			const code = `
				const avg = env.records.reduce((s, r) => s + r.accountHolder.length, 0) / env.records.length;
				return { avgNameLength: Math.round(avg) };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block direct character indexing on PII", () => {
			const code = `
				const first = env.records[0].accountHolder[0];
				return { firstChar: first };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});

	describe("String transformation on PII (MUST BLOCK)", () => {
		it("should block split on PII field", () => {
			const code = `
				const parts = env.records.map(r => r.name.split(' '));
				return { parts };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block slice/substring on PII", () => {
			const code = `
				const initials = env.records.map(r => r.name.slice(0, 1));
				return { initials };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block indexOf on PII (position leaks content)", () => {
			const code = `
				const pos = env.records.map(r => r.name.indexOf('a'));
				return { positions: pos };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});

	// ── MUST ALLOW: Legitimate aggregations on non-PII fields ────────

	describe("Legitimate non-PII aggregations (MUST ALLOW)", () => {
		it("should allow simple record count", () => {
			const code = `
				return { n: env.records.length };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow count + average balance (2 numeric fields)", () => {
			const code = `
				const n = env.records.length;
				const avg = env.records.reduce((s, r) => s + r.balance, 0) / n;
				return { n, avg: Math.round(avg) };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow stddev calculation on non-PII field", () => {
			const code = `
				const prices = env.records.map(r => r.price);
				const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
				const variance = prices.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / prices.length;
				return { n: prices.length, stddev: Math.round(Math.sqrt(variance)) };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow Math.max on non-PII field", () => {
			const code = `
				const max = Math.max(...env.records.map(r => r.balance));
				return { maxBalance: max };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow filter count on non-PII condition", () => {
			const code = `
				const highPE = env.records.filter(r => r.peRatio > 20).length;
				const lowPE = env.records.filter(r => r.peRatio <= 20).length;
				return { highPEcount: highPE, lowPEcount: lowPE };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow transaction amount aggregation", () => {
			const code = `
				const all = env.records.flatMap(r => r.transactions.map(t => t.amount));
				const avg = all.reduce((s, v) => s + v, 0) / all.length;
				return { n: all.length, avgAmount: Math.round(avg) };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should allow count + total transactions (2 numeric fields)", () => {
			const code = `
				const n = env.records.length;
				const total = env.records.reduce((s, r) => s + r.transactions.length, 0);
				return { n, totalTx: total };
			`;
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────

	describe("Edge cases", () => {
		it("should handle syntax errors gracefully (return null)", () => {
			const code = "this is not valid javascript {{{";
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should handle empty code", () => {
			const code = "";
			const result = analyzer.analyze(code);
			expect(result).toBeNull();
		});

		it("should handle code with no return statement", () => {
			const code = `
				const x = env.records[0].accountHolder.charCodeAt(0);
			`;
			const result = analyzer.analyze(code);
			// No return = no exfiltration path, should be null
			expect(result).toBeNull();
		});

		it("should block for-of loop PII access", () => {
			const code = `
				const codes = [];
				for (const r of env.records) {
					codes.push(r.name.charCodeAt(0));
				}
				return { codes };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});

	describe("Generator / Iterator side-channel (MUST BLOCK)", () => {
		it("should block generator yielding PII field", () => {
			const code = `
				const gen = function*() {
					for (const r of env.records) {
						yield r.name;
					}
				};
				const it = gen();
				return { v0: it.next().value, v1: it.next().value };
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should extract queried fields from generator loops", () => {
			const code = `
				const gen = function*() {
					for (const r of env.records) {
						yield r.balance;
					}
				};
			`;
			const fields = analyzer.extractQueriedFields(code);
			expect(fields).toContain("balance");
		});
	});

	describe("Computed property key exfiltration (MUST BLOCK)", () => {
		it("should block PII used as dynamic key in reduce accumulator", () => {
			const code = `
				const accounts = env.records;
				const top5 = accounts.filter((_, i) => i < 5);
				return top5.reduce((acc, a) => {
					acc[a.accountHolder] = a.balance;
					return acc;
				}, {});
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});

		it("should block PII used as computed key in object literal", () => {
			const code = `
				const accounts = env.records;
				return accounts.map(a => ({ [a.accountHolder]: a.balance }));
			`;
			const result = analyzer.analyze(code);
			expect(result).not.toBeNull();
		});
	});
});
