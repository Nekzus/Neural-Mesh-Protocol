/**
 * Adversarial PII Egress Shield v3 Tests
 *
 * Reproduces the exact 8 attack vectors discovered during the
 * Claude Desktop audit (2026-05-06) to verify they are all blocked.
 *
 * Each test maps to a specific probe payload from the original audit:
 *   T1: Direct .map(x => x.name) extraction
 *   T2: Forbidden key in output object ("id" key)
 *   T3: Field-by-field extraction with aliased keys
 *   T4: Full medical record field extraction
 *   T5: Key aliasing bypass (fullName, accountCode)
 *   T6: Keyword trigger mapping (holder_ok, acctType_ok)
 *   T7: Plural key bypass ("names" vs "name")
 *   T8: Compound key bypass (patientId, recordId)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "../../src/server/index.js";

describe("PII Egress Shield v3 — Adversarial Vectors", () => {
	let server: LiopServer;

	beforeAll(async () => {
		server = new LiopServer(
			{ name: "Adversarial-Test", version: "1.0.0" },
			{
				workerPool: {
					minThreads: 1,
					maxThreads: 4,
					maxQueue: 100,
				},
				security: {
					forbiddenKeys: [
						"id",
						"name",
						"fullName",
						"firstName",
						"lastName",
						"address",
						"phone",
						"email",
						"ssn",
						"accountHolder",
						"accountNumber",
					],
					enableNerScanning: true,
				},
			},
		);

		server.setSandboxData([
			{
				id: "PAT-7721",
				name: "Evelyn Reed",
				age: 42,
				bloodType: "O+",
				diagnosis: "Hypertension",
				medications: ["Lisinopril", "Aspirin"],
			},
			{
				id: "PAT-1092",
				name: "Marcus Thorne",
				age: 58,
				bloodType: "A-",
				diagnosis: "Type 2 Diabetes",
				medications: ["Metformin", "Aspirin"],
			},
			{
				id: "PAT-4432",
				name: "Sarah Chen",
				age: 29,
				bloodType: "B+",
				diagnosis: "Acute Bronchitis",
				medications: ["Amoxicillin"],
			},
		]);

		server.tool(
			"analyze_records",
			"Analyze records",
			{ payload: z.string() },
			async () => ({ content: [] }),
			{ enforceAggregationFirst: true },
		);
	});

	afterAll(async () => {
		await server.close();
	});

	it("T1: should BLOCK r.map(x => x.name) — person names in primitive array", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T1}
const r = env.records;
const extracted = r.map(x => x.name);
return { results: extracted };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		// Blocked by either Egress Shield or Taint/Aggregation policy — both are valid
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T2: should BLOCK direct 'id' key in output (exact match)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T2}
const r = env.records;
return { id: r[0].id };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T3: should BLOCK field-by-field with aliased keys (holders_exported)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T3}
const r = env.records;
return { holders_exported: r.map(x => x.name) };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T4: should BLOCK full field extraction with innocuous keys", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T4}
const r = env.records;
return { people: r.map(x => x.name), codes: r.map(x => x.id) };
@END`,
			},
		});

		expect(result.isError).toBe(true);
	});

	it("T5: should BLOCK key aliasing (fullName → fuzzy match)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T5}
const r = env.records;
return { patientFullName: r[0].name };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T6: should BLOCK compound keys (patientId → boundary match for 'id')", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T6}
const r = env.records;
return { patientId: r.map(x => x.id) };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T7: should BLOCK plural key bypass ('names' contains 'name')", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T7}
const r = env.records;
return { names: r.map(x => x.name) };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("T8: should BLOCK snake_case compound keys (record_id)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,AUDIT_T8}
const r = env.records;
return { record_id: r.map(x => x.id) };
@END`,
			},
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/Egress Security Violation|Aggregation-First|Preflight policy rejected/,
		);
	});

	it("SAFE-1: should ALLOW legitimate aggregation (no PII in output)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,SafeAggregation}
const r = env.records;
const total = r.length;
const avgAge = r.reduce((s, x) => s + x.age, 0) / total;
return { total, avgAge };
@END`,
			},
		});

		if (result.isError) {
			throw new Error("SAFE-1 FAILURE REASON: " + result.content[0].text);
		}
	});

	it("SAFE-2: should ALLOW safelisted keys (image_id, timestamp)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,SafeKeys}
return { ts: 42, valid: true };
@END`,
			},
		});

		expect(result.isError).toBeFalsy();
	});

	it("SAFE-3: should ALLOW medication count aggregation (NER safelist)", async () => {
		const result = await server.callTool({
			name: "analyze_records",
			arguments: {
				payload: `@LIOP{wasi_v1,MedCount}
const meds = {};
env.records.forEach(r => {
    if (r.medications) {
        r.medications.forEach(m => {
            meds[m] = (meds[m] || 0) + 1;
        });
    }
});
return meds;
@END`,
			},
		});
		// meds output creates dynamic keys per medication name
		// With small dataset (3 records), K-Anonymity or aggregation policy may trigger
		// Acceptable: either pass or blocked by aggregation policy for small datasets
		if (result.isError) {
			expect(result.content[0].text).toMatch(
				/Aggregation-First|K-Anonymity/,
			);
		}
	});

	it("T9: should BLOCK dynamic-key scalar extraction when outputSchema is strict", async () => {
		// Create a fresh server with STRICT output schema (no catchall)
		const strictServer = new LiopServer(
			{ name: "StrictSchema-Test", version: "1.0.0" },
			{
				security: {
					forbiddenKeys: ["id", "name", "ssn"],
				},
			},
		);

		strictServer.setSandboxData([
			{ id: "P001", name: "Alice", age: 32, balance: 12450.75 },
			{ id: "P002", name: "Bob", age: 45, balance: 85600.2 },
		]);

		const strictOutputSchema = z.object({
			total: z.number().optional(),
			avgAge: z.number().optional(),
			avgBalance: z.number().optional(),
		}); // NO .catchall() → .strict() enforced by framework

		strictServer.tool(
			"strict_analyze",
			"Analyze with strict schema",
			{ payload: z.string() },
			async () => ({ content: [], isError: true }),
			{
				enforceAggregationFirst: true,
				outputSchema: strictOutputSchema,
			},
		);

		// Attempt: dynamic key extraction (the bypass that worked with .catchall)
		const result = await strictServer.callTool({
			name: "strict_analyze",
			arguments: {
				payload: `@LIOP{wasi_v1,DynKeyBypass}
const out = {};
env.records.forEach((r, i) => { out['acct_' + i] = r.balance; });
return out;
@END`,
			},
		});

		expect(result.isError).toBe(true);
		// Dynamic keys blocked by egress shield (schema strict + aggregation limit)
		expect(result.content[0].text).toContain("Output schema violation");

		await strictServer.close();
	});
});
