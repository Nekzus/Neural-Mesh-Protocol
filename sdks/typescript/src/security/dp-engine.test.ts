// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Differential Privacy Engine — Test Suite (Phase 110 — NIST SP 800-226)
 *
 * Validates Laplace noise injection with CSPRNG, query-aware sensitivity,
 * epsilon floor, and data integrity guarantees.
 */

import { describe, expect, it } from "vitest";
import { addLaplaceNoise, applyDpToOutput } from "./dp-engine.js";

describe("Differential Privacy Engine", () => {
	describe("addLaplaceNoise", () => {
		it("should add noise to a numeric value", () => {
			const original = 100;
			const noisy = addLaplaceNoise(original, {
				epsilon: 1.0,
				sensitivity: 1.0,
			});
			// Noise should change the value (probability of exact match is ~0)
			expect(noisy).not.toBe(original);
			expect(typeof noisy).toBe("number");
			expect(Number.isFinite(noisy)).toBe(true);
		});

		it("should produce different noise on each call", () => {
			const results = new Set<number>();
			for (let i = 0; i < 20; i++) {
				results.add(addLaplaceNoise(1000, { epsilon: 1.0, sensitivity: 1.0 }));
			}
			// At least 15 of 20 should be distinct (extremely high probability)
			expect(results.size).toBeGreaterThanOrEqual(15);
		});

		it("should produce larger noise with smaller epsilon", () => {
			const deviationsHigh: number[] = [];
			const deviationsLow: number[] = [];
			const original = 1000;
			const runs = 200;

			for (let i = 0; i < runs; i++) {
				deviationsHigh.push(
					Math.abs(
						addLaplaceNoise(original, {
							epsilon: 10.0,
							sensitivity: 1.0,
						}) - original,
					),
				);
				deviationsLow.push(
					Math.abs(
						addLaplaceNoise(original, {
							epsilon: 0.1,
							sensitivity: 1.0,
						}) - original,
					),
				);
			}

			const avgHigh = deviationsHigh.reduce((s, v) => s + v, 0) / runs;
			const avgLow = deviationsLow.reduce((s, v) => s + v, 0) / runs;

			// Low epsilon should produce ~100x more noise than high epsilon
			expect(avgLow).toBeGreaterThan(avgHigh * 5);
		});
	});

	describe("applyDpToOutput", () => {
		it("should apply noise to all numeric leaves but respect semantic clamping", () => {
			const output = { total: 440150.95, count: 3, label: "test" };
			const noisy = applyDpToOutput(
				output,
				{ epsilon: 1.0, sensitivity: 100 },
				3,
			);

			expect(noisy).toHaveProperty("total");
			expect(noisy).toHaveProperty("count");
			expect(noisy).toHaveProperty("label");

			const n = noisy as Record<string, unknown>;
			// Count should be an integer, non-negative (query-aware: sensitivity=1)
			expect(Number.isInteger(n.count)).toBe(true);
			expect((n.count as number) >= 0).toBe(true);
			// String should be preserved
			expect(n.label).toBe("test");
		});

		it("should NOT apply noise when recordCount >= threshold", () => {
			const output = { total: 440150.95, count: 100 };
			const result = applyDpToOutput(
				output,
				{ smallDatasetThreshold: 50 },
				100,
			);

			const r = result as Record<string, unknown>;
			// Values should be unchanged when above threshold
			expect(r.total).toBe(440150.95);
			expect(r.count).toBe(100);
		});

		it("should handle nested objects and enforce non-negative constraint", () => {
			// Using small base values and very high sensitivity to force negative noise
			const output = { stats: { avg: 50.5, max: 100 }, n: 0 };
			const noisy = applyDpToOutput(
				output,
				{ epsilon: 0.001, sensitivity: 1000 },
				5,
			);

			const n = noisy as Record<string, unknown>;
			const stats = n.stats as Record<string, unknown>;
			// avg should be non-negative (original was >= 0)
			expect((stats.avg as number) >= 0).toBe(true);

			// n was 0, an integer. It should be clamped to >= 0
			expect(Number.isInteger(n.n)).toBe(true);
			expect((n.n as number) >= 0).toBe(true);
		});

		it("should handle arrays of numbers", () => {
			const output = { values: [10, 20, 30] };
			const noisy = applyDpToOutput(
				output,
				{ epsilon: 1.0, sensitivity: 100 },
				3,
			);

			const n = noisy as Record<string, unknown>;
			const values = n.values as number[];
			expect(values).toHaveLength(3);
			// At least one should differ
			const anyDifferent = values.some((v, i) => v !== [10, 20, 30][i]);
			expect(anyDifferent).toBe(true);
		});

		it("should preserve booleans and null", () => {
			const output = { flag: true, empty: null, val: 42.5 };
			const noisy = applyDpToOutput(
				output,
				{ epsilon: 1.0, sensitivity: 100 },
				3,
			);

			const n = noisy as Record<string, unknown>;
			expect(n.flag).toBe(true);
			expect(n.empty).toBeNull();
			expect(n.val).not.toBe(42.5); // Numeric should be noisy (stabilized with float to avoid round-to-zero flakiness)
		});

		it("should return primitive numbers with noise when output is just a number", () => {
			const noisy = applyDpToOutput(
				42.5,
				{ epsilon: 1.0, sensitivity: 100 },
				3,
			);
			expect(typeof noisy).toBe("number");
			expect(noisy).not.toBe(42.5);
		});

		it("should NEVER mutate the original input object (data integrity)", () => {
			const output = { total: 5000, count: 10, nested: { avg: 500 } };
			const snapshot = JSON.stringify(output);

			applyDpToOutput(output, { epsilon: 1.0, sensitivity: 100 }, 5);

			// The original object must be completely unchanged
			expect(JSON.stringify(output)).toBe(snapshot);
		});

		it("should enforce epsilon floor for n < 10 (NIST SP 800-226)", () => {
			// With epsilon=0.01 and sensitivity=1, normal scale would be 100.
			// Epsilon floor forces epsilon=1.0, so scale should be 1.
			const deviations: number[] = [];
			const runs = 200;
			for (let i = 0; i < runs; i++) {
				const noisy = applyDpToOutput(
					{ count: 100 },
					{ epsilon: 0.01, sensitivity: 1.0 },
					3, // n < 10 → floor activates
				);
				deviations.push(
					Math.abs((noisy as Record<string, number>).count - 100),
				);
			}
			const avgDeviation = deviations.reduce((s, v) => s + v, 0) / runs;
			// With epsilon floor = 1.0 and count sensitivity = 1, scale = 1.
			// Mean absolute deviation of Laplace(0, 1) is 1.0.
			// Average deviation should be close to 1, NOT close to 100.
			expect(avgDeviation).toBeLessThan(10);
		});
	});
});
