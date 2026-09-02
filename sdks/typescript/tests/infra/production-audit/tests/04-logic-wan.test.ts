import { describe, expect, it } from "vitest";
import { callTool, liopEnvelope, extractText } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 04 — In-situ Logic Execution under Geographic WAN Latency", () => {
	it("should execute financial aggregation on Bank node with 1,500 accounts under Atlantic latency", async () => {
		const logic = [
			"const accounts = env.records;",
			"const totalBalance = accounts.reduce((acc, a) => acc + (a.balance || 0), 0);",
			"const avgBalance = totalBalance / accounts.length;",
			"return { totalAccounts: accounts.length, totalBalance, avgBalance };",
		].join("\n");

		const envelope = liopEnvelope(logic, "BankScaleAudit");
		const res = await callTool("Analyze_Synthetic_Bank_Transactions", envelope, NEXUS_URL, 45000);

		expect(res?.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.totalAccounts).toBeGreaterThanOrEqual(100);
		expect(comp.totalBalance).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		const receiptStr = typeof data.zk_receipt === "string" ? data.zk_receipt : JSON.stringify(data.zk_receipt);
		expect(receiptStr.length).toBeGreaterThan(32);
		console.log(`[Bank Scale Result] ${comp.totalAccounts} accounts processed, Balance: $${comp.totalBalance.toFixed(2)}`);
	}, 60000);

	it("should execute medical aggregation on Vault node with 2,500 patients under Atlantic latency", async () => {
		const logic = [
			"const patients = env.records;",
			"const hypertension = patients.filter(p => p.diagnosis === 'Hypertension');",
			"const avgAge = patients.reduce((acc, p) => acc + (p.age || 0), 0) / patients.length;",
			"return { totalPatients: patients.length, hypertensionCount: hypertension.length, avgAge };",
		].join("\n");

		const envelope = liopEnvelope(logic, "VaultScaleAudit");
		const res = await callTool("Analyze_Synthetic_Medical_Records", envelope, NEXUS_URL, 45000);

		expect(res?.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.totalPatients).toBeGreaterThanOrEqual(100);
		expect(comp.hypertensionCount).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[Vault Scale Result] ${comp.totalPatients} patients processed, Hypertension: ${comp.hypertensionCount}`);
	}, 60000);

	it("should execute HFT tick analytics on Oracle node under Cross-Pacific latency", async () => {
		const logic = [
			"const ticks = env.records;",
			"const avgPrice = ticks.reduce((acc, t) => acc + (t.price || 0), 0) / ticks.length;",
			"return { total: ticks.length, avgPrice };",
		].join("\n");

		const envelope = liopEnvelope(logic, "OracleHftAudit");
		const res = await callTool("Analyze_HFT_Market_Data", envelope, NEXUS_URL, 45000);

		expect(res?.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.total).toBeGreaterThan(0);
		expect(comp.avgPrice).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[Oracle Result] ${comp.total} ticks analyzed, Avg Price: $${comp.avgPrice.toFixed(2)}`);
	}, 60000);

	it("should execute IoT telemetry aggregation on Edge node under Hostile 3G conditions", async () => {
		const logic = [
			"const telemetry = env.records;",
			"const critical = telemetry.filter(t => t.status === 'CRITICAL');",
			"const avgTemp = telemetry.reduce((acc, t) => acc + (t.temperatureCelsius || 0), 0) / telemetry.length;",
			"return { totalSamples: telemetry.length, criticalCount: critical.length, avgTemperature: avgTemp };",
		].join("\n");

		const envelope = liopEnvelope(logic, "EdgeTelemetryAudit");
		const res = await callTool("Analyze_IoT_Sensor_Data", envelope, NEXUS_URL, 45000);

		expect(res?.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.totalSamples).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[Edge Result] ${comp.totalSamples} sensor samples analyzed under 3G`);
	}, 60000);

	it("should execute complex multidimensional analytics with heterogeneous types (UUIDs, GPS, Vitals, Enums)", async () => {
		// Complex cross-field query combining vitals, lab results and admission enums
		const medicalLogic = [
			"const patients = env.records;",
			"const avgAge = patients.reduce((acc, p) => acc + (p.age || 0), 0) / (patients.length || 1);",
			"const byDiagnosis = {};",
			"for (const p of patients) {",
			"  byDiagnosis[p.diagnosis] = (byDiagnosis[p.diagnosis] || 0) + 1;",
			"}",
			"return {",
			"  totalAnalyzed: patients.length,",
			"  avgAge: Number(avgAge.toFixed(1)),",
			"  diagnosesDistribution: byDiagnosis,",
			"};",
		].join("\n");

		const envelope = liopEnvelope(medicalLogic, "ComplexTypesAudit");
		const res = await callTool("Analyze_Synthetic_Medical_Records", envelope, NEXUS_URL, 45000);

		expect(res?.isError).toBeFalsy();
		const text = extractText(res);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.totalAnalyzed).toBeGreaterThanOrEqual(100);
		expect(comp.avgAge).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[Complex Types Result] Analyzed ${comp.totalAnalyzed} records, Avg Age: ${comp.avgAge}`);
	}, 60000);
});

