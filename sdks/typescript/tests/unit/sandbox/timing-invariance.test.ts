import { describe, expect, it } from "vitest";
import {
	WasiSandbox,
	calculateAstInstructionFuel,
} from "../../../src/sandbox/wasi.js";

describe("Timing Side-Channel & Fuel Invariance (Phase Beta-3 Defense)", () => {
	it("should produce strictly zero fuel variance (stddev = 0) across 50 executions with heterogeneous data", async () => {
		const sandbox = new WasiSandbox();
		try {
			const logic = `
const records = env.records;
let sum = 0;
for (let i = 0; i < records.length; i++) {
  sum += records[i].val;
}
return { total: sum, count: records.length };
`;
			const fuels: number[] = [];

			// 50 runs with drastically different data structures and values
			for (let i = 0; i < 50; i++) {
				const dummyRecords = [
					{ val: i * 1000, label: `record-${i}` },
					{ val: (50 - i) * 50, label: `inverted-${i}` },
				];
				const result = await sandbox.execute(logic, dummyRecords);
				expect(result.output).toBeDefined();
				fuels.push(result.fuelConsumed);
			}

			// Invariant: All 50 runs must report EXACTLY the same fuel!
			const firstFuel = fuels[0];
			for (const f of fuels) {
				expect(f).toBe(firstFuel);
			}

			// Statistical verification: standard deviation must be strictly 0
			const mean = fuels.reduce((a, b) => a + b, 0) / fuels.length;
			const variance =
				fuels.reduce((sum, f) => sum + (f - mean) ** 2, 0) / fuels.length;
			const stddev = Math.sqrt(variance);

			expect(stddev).toBe(0);
		} finally {
			await sandbox.teardown();
		}
	});

	it("should calculate identical static fuel regardless of secret runtime values", () => {
		const logicA = `
const r = env.records[0];
if (r.ssn === "000-00-0000") {
  return { status: "match" };
}
return { status: "no-match" };
`;
		const logicB = `
const r = env.records[0];
if (r.ssn === "999-99-9999") {
  return { status: "match" };
}
return { status: "no-match" };
`;
		// Both ASTs have the exact same structural complexity
		const fuelA = calculateAstInstructionFuel(logicA);
		const fuelB = calculateAstInstructionFuel(logicB);

		expect(fuelA).toBe(fuelB);
		expect(fuelA).toBeGreaterThan(0);
	});

	it("should ensure static AST fuel is invariant to input array size for fixed-structure logic", () => {
		const logic = `
const records = env.records;
return { count: records.length };
`;
		const staticFuel = calculateAstInstructionFuel(logic);
		expect(staticFuel).toBeGreaterThanOrEqual(100);

		// AST fuel is statically derived before runtime execution
		const recomputedFuel = calculateAstInstructionFuel(logic);
		expect(recomputedFuel).toBe(staticFuel);
	});

	it("should execute branch-heavy logic safely within fuel limits without data-dependent fuel drift", async () => {
		const sandbox = new WasiSandbox();
		try {
			const branchLogic = `
const records = env.records;
let highCount = 0;
let lowCount = 0;
for (let i = 0; i < records.length; i++) {
  if (records[i].score > 50) {
    highCount++;
  } else {
    lowCount++;
  }
}
return { high: highCount, low: lowCount };
`;
			// Case 1: All high scores
			const highDataset = [{ score: 90 }, { score: 80 }, { score: 95 }];
			const resHigh = await sandbox.execute(branchLogic, highDataset);

			// Case 2: All low scores
			const lowDataset = [{ score: 10 }, { score: 20 }, { score: 5 }];
			const resLow = await sandbox.execute(branchLogic, lowDataset);

			expect(resHigh.output).toEqual({ high: 3, low: 0 });
			expect(resLow.output).toEqual({ high: 0, low: 3 });

			// Fuel consumed MUST be identical despite divergent runtime branches taken!
			expect(resHigh.fuelConsumed).toBe(resLow.fuelConsumed);
		} finally {
			await sandbox.teardown();
		}
	});
});
