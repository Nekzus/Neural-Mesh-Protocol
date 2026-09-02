/**
 * LIOP Vault Node — Healthcare Data Provider (Production Package Audit)
 *
 * Runs the published @nekzus/liop package in a realistic WAN environment.
 * Evaluates HIPAA Expert Determination Privacy, PII Egress Shield, and ZK-Receipts
 * with 500 scale = 2,500 patient records.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";
import { generateMedicalDataset } from "../utils/datasetGenerator.js";

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const liopServer = new LiopServer(
		{
			name: "PRODUCTION-the-vault",
			version: "2.5.0",
		},
		{
			tokenSlug: "VAULT",
			auth: {
				role: "node",
				nexusUrl: "http://nexus:3000",
				revocationPath: path.join(dataDir, "vault-revocations.json"),
			},
			taxonomy: {
				domain: "Healthcare (REALISTIC PRODUCTION AUDIT)",
				clearanceTier: 5,
				executionTypes: ["Blind AST Logic", "Zero-Trust Worker Pool"],
			},
			budgetStorePath: path.join(dataDir, "vault-query-budgets.json"),
		},
	);

	// Scaled Healthcare Dataset (Default scale: 500 = 2,500 records)
	const scaleEnv = process.env.LIOP_DATASET_SCALE;
	const scale = scaleEnv ? Number.parseInt(scaleEnv, 10) : 500;
	const patients = generateMedicalDataset(Number.isNaN(scale) ? 500 : scale);
	console.log(`[Vault-Prod] Loaded ${patients.length} synthetic patient records (scale=${scale})`);

	liopServer.dataDictionary(
		{
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", description: "Patient Unique ID (PAT-XXXX)" },
					uuid: { type: "string", format: "uuid", description: "Clinical UUIDv4" },
					name: { type: "string" },
					age: { type: "number" },
					bloodType: { type: "string" },
					diagnosis: { type: "string" },
					admissionStatus: { type: "string", enum: ["INPATIENT", "OUTPATIENT", "DISCHARGED"] },
					registeredAt: { type: "string", format: "date-time" },
					lastVisit: { type: "string", format: "date" },
					medications: { type: "array", items: { type: "string" } },
					vitals: {
						type: "object",
						properties: {
							systolic: { type: "number" },
							diastolic: { type: "number" },
							heartRate: { type: "number" },
							tempCelsius: { type: "number" },
							spo2: { type: "number" },
						},
					},
					labResults: {
						type: "object",
						properties: {
							fastingGlucoseMgDl: { type: "number" },
							hba1cPercent: { type: "number" },
							totalCholesterolMgDl: { type: "number" },
						},
					},
					clinicalRiskScore: { type: "number", minimum: 0, maximum: 1 },
				},
			},
		},
		"Medical Records Schema (PRODUCTION AUDIT)",
		"LIOP://schema/medical-records-synthetic",
	);

	liopServer.setSandboxData(patients as unknown as Record<string, unknown>[]);

	const medicalAggregatedOutputSchema = z
		.object({
			totalPatients: z.number().optional(),
			hypertensionCount: z.number().optional(),
			percentage: z.union([z.number(), z.string()]).optional(),
			averageAge: z.union([z.number(), z.string()]).optional(),
			avgAge: z.union([z.number(), z.string()]).optional(),
			diagnosesDistribution: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			byDiagnosis: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			clientPayload: z.string().optional(),
		})
		.catchall(z.union([z.number(), z.string(), z.boolean()]));

	liopServer.tool(
		"Analyze_Synthetic_Medical_Records",
		"Production Audit: Performs secure Logic-on-Origin processing on the medical records dataset under cross-datacenter WAN latency.",
		{ payload: z.string() },
		async (_params) => {
			return {
				content: [
					{
						type: "text",
						text: "[LIOP] Security Enforcement: Legacy Plain-Tool execution is BLOCKED on this node. You MUST use the Compact Envelope (@LIOP) to trigger the secure Zero-Trust WASI sandbox for medical record analysis.",
					},
				],
				isError: true,
			};
		},
		{
			enforceAggregationFirst: true,
			outputSchema: medicalAggregatedOutputSchema,
			dpEpsilon: 2.0,
			dpSensitivity: 1.0,
			sensitiveKeys: ["diagnosis", "bloodType"],
		},
	);

	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER || "/ip4/172.21.0.10/tcp/4000";

	await liopServer.connectToMesh({
		port: 50051,
		meshConfig: {
			identityPath: path.join(dataDir, "vault-identity.json"),
			listenAddresses: ["/ip4/0.0.0.0/tcp/4000"],
			bootstrapNodes: [bootstrapSeed],
		},
	});

	const meshNode = liopServer.getMeshNode();
	if (!meshNode) throw new Error("MeshNode failed to initialize");

	await meshNode.announceCapability("liop:manifest");

	const gateway = new LiopHybridGateway(liopServer, meshNode, 50051);
	const port = await gateway.listen(3000);
	console.log(`[Vault-Prod] Gateway active on port ${port}`);

	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15003/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "vault.multiaddr"), p2pAddr);
	console.log(`[Vault-Prod] Industrial Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[Vault-Prod] Shutdown signal received. Closing servers...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("[Vault-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
