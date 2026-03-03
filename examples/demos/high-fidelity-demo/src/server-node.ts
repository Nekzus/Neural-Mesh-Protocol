// "The Vault" - Hi-Fi NMP Data Node

import { NmpServer, PII_PATTERNS } from "@nekzus/neural-mesh/server";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.error("██████╗  █████╗ ███████╗███████╗");
console.error("██╔══██╗██╔══██╗██╔════╝██╔════╝");
console.error("██████╔╝███████║███████╗█████╗  ");
console.error("██╔══██╗██╔══██║╚════██║██╔══╝  ");
console.error("██████╔╝██║  ██║███████║███████╗");
console.error("╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝");
console.error(">>> THE VAULT (High-Fidelity NMP Server) is online.\n");

export const theVaultServer = new NmpServer(
	{ name: "TheVault", version: "1.0.0" },
	{
		capabilities: { tools: { listChanged: true } },
		security: {
			piiPatterns: [
				PII_PATTERNS.EMAIL,
				PII_PATTERNS.IP_ADDRESS,
				PII_PATTERNS.CREDIT_CARD,
			],
			// Dynamic O(1) Memory Layout Keys injection
			forbiddenKeys: [
				"id",
				"ssn",
				"social_security",
				"password",
				"token",
				"secret",
				"address",
				"phone",
				"email",
				"name",
				"nombre",
				"apellido",
				"birth",
				"nacimiento",
			],
		},
	},
);

// 0. Load and Inject Data Context into the SDK (Fase 45 Perfect Parity)
try {
	const dataPath = path.resolve(__dirname, "../data/medical_records.json");
	const recordsRaw = await fs.readFile(dataPath, "utf-8");
	const records = JSON.parse(recordsRaw);
	theVaultServer.setSandboxData(records);
} catch (e) {
	console.error(`[The Vault] Error loading medical records: ${e}`);
}

// 1. Data Dictionary First (Establish the Schema for the SDK)
theVaultServer.dataDictionary(
	{
		id: "string (Anonymized patient identifier, strictly PII)",
		age: "number (Patient age in years)",
		condition:
			"string (Primary medical condition: Healthy, Hypertension, Asthma, Diabetes Type 1, Diabetes Type 2, Heart Disease)",
		riskScore: "number (Float risk numeric score from 0.0 to 1.0)",
		lastVisit: "string (ISO 8601 Date of the last medical appointment)",
	},
	"medical_records_schema",
	"nmp://schema/medical_records",
	"Strict JSON schema for the patient database (records). The sandbox injects 'env.records'.",
);

// 2. Enable Autonomy & Registered Tools (Now aware of the schema)
theVaultServer.enableZeroShotAutonomy();

theVaultServer.tool(
	"nmp_audit_sandbox",
	"Inject remote WASM/JS code for blind analysis over sensitive medical data. Protected by Guardian AST and WASI Fuel Limits.",
	{
		payload: z
			.string()
			.describe(
				"The packed Logic-on-Origin module string encapsulating JavaScript.",
			),
	},
	async ({ payload }) => {
		// NOTE: In Fase 45, NmpServer's middleware automatically intercepts
		// any payload containing ---BEGIN_LOGIC--- and executes it in 
		// the Worker Pool using the injected data context (setSandboxData).
		// This handler only executes if the middleware is bypassed or for non-Logic payloads.
		return {
			content: [
				{
					type: "text",
					text: "The Vault received your request. Using Tier-0 Native Middleware (Worker Pool + SDK Isolation).",
				},
			],
		};
	},
);



