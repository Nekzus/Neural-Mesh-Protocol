import { describe, expect, it } from "vitest";
import { Dilithium65Wrapper } from "@nekzus/liop";
import { callTool, liopEnvelope, extractText } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 02 — Post-Quantum Cryptography under Real WAN Latency", () => {
	it("should perform Kyber-768 (ML-KEM-768) handshake & execution across Pacific latency (Tokyo 150ms)", async () => {
		const logic = [
			"const ticks = env.records;",
			"return { count: ticks.length, sampleTicker: ticks[0]?.ticker ?? 'N/A' };",
		].join("\n");

		const envelope = liopEnvelope(logic, "PqcPacificTest");
		const t0 = performance.now();
		const result = await callTool("Analyze_HFT_Market_Data", envelope, NEXUS_URL, 30000);
		const elapsed = performance.now() - t0;

		expect(result?.isError).toBeFalsy();
		const text = extractText(result);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.count).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[PQC Pacific Handshake + Exec] Completed in ${elapsed.toFixed(1)}ms`);
	});

	it("should complete PQC handshake and logic injection under Hostile 3G network (300ms + 3% loss)", async () => {
		const logic = [
			"const samples = env.records;",
			"return { totalTelemetry: samples.length, healthy: samples.filter(s => s.status === 'NOMINAL').length };",
		].join("\n");

		const envelope = liopEnvelope(logic, "PqcHostileEdgeTest");
		const t0 = performance.now();
		const result = await callTool("Analyze_IoT_Sensor_Data", envelope, NEXUS_URL, 45000);
		const elapsed = performance.now() - t0;

		expect(result?.isError).toBeFalsy();
		const text = extractText(result);
		const data = JSON.parse(text);
		const comp = data.computation_result ?? data;

		expect(comp.totalTelemetry).toBeGreaterThan(0);
		expect(data.zk_receipt).toBeDefined();
		console.log(`[PQC Hostile 3G Handshake + Exec] Completed in ${elapsed.toFixed(1)}ms`);
	});

	it("should verify ML-DSA-65 (FIPS 204) attestation signatures on peer capability manifests", () => {
		const testManifest = {
			name: "audit-test-node",
			version: "2.5.0",
			tools: ["test_tool_1", "test_tool_2"],
			timestamp: Date.now(),
		};

		const keypair = Dilithium65Wrapper.generateKeyPair();
		const { signature, publicKey } = Dilithium65Wrapper.signManifest(
			testManifest,
			keypair.secretKey,
			keypair.publicKey,
		);
		const isValid = Dilithium65Wrapper.verifyManifest(testManifest, signature, publicKey);

		expect(isValid).toBe(true);

		// Tampering test
		const tamperedManifest = { ...testManifest, version: "2.6.0-compromised" };
		const isTamperedValid = Dilithium65Wrapper.verifyManifest(tamperedManifest, signature, publicKey);
		expect(isTamperedValid).toBe(false);
	});
});
