import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NmpServer } from "@neural-mesh/sdk/server";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "../data/medical_records.json");

const server = new NmpServer({
	name: "Production-Data-Node",
	version: "1.0.0",
});

// Rescue the local data that the server protects
const loadLocalData = async () => {
	const content = await fs.readFile(DATA_PATH, "utf-8");
	return JSON.parse(content);
};

// Register the audit tool natively
server.tool(
	"audit_records",
	"Performs a secure multi-variable audit on protected medical records using logic-on-origin",
	{
		auditId: z.string(),
		minRisk: z.number().default(0.7),
	},
	async (params, _context) => {
		console.log(
			`[NMP-SERVER] Logic-on-Origin received for Audit: ${params.auditId}`,
		);

		// The SDK handles security, PQC, and the Sandbox internally
		// Here we simulate the secure access the Sandbox has to the data
		const data = await loadLocalData();

		console.log(`[NMP-SERVER] Executing logic over ${data.length} records...`);

		const anomalies = data.filter(
			(r: { risk_score: number }) => r.risk_score >= params.minRisk,
		);

		// The SDK packages the result and generates ZK receipts automatically
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						status: "SUCCESS",
						audit_id: params.auditId,
						found_count: anomalies.length,
						anomalies: anomalies.map(
							(a: { id: string | number; risk_score: number }) => ({
								id: a.id,
								risk: a.risk_score,
							}),
						),
					}),
				},
			],
			isError: false,
		};
	},
);

console.log(
	"------------------------------------------------------------------",
);
console.log(
	"   NMP PRODUCTION SERVER - READY TO RECEIVE LOGIC                ",
);
console.log(
	"------------------------------------------------------------------",
);

server.connectToMesh().catch((err) => {
	console.error("Failed to start server:", err);
});
