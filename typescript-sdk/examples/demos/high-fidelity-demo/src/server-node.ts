// "The Vault" - Hi-Fi NMP Data Node

import { NmpServer } from "@neural-mesh/sdk/server";
import { z } from "zod";
import { GuardianAST } from "./lib/guardian-ast.js";
import { WasiSandbox } from "./lib/wasi-sandbox.js";

console.error("██████╗  █████╗ ███████╗███████╗");
console.error("██╔══██╗██╔══██╗██╔════╝██╔════╝");
console.error("██████╔╝███████║███████╗█████╗  ");
console.error("██╔══██╗██╔══██║╚════██║██╔══╝  ");
console.error("██████╔╝██║  ██║███████║███████╗");
console.error("╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝");
console.error(">>> THE VAULT (High-Fidelity NMP Server) is online.\n");

export const theVaultServer = new NmpServer(
	{ name: "TheVault", version: "1.0.0" },
	{ capabilities: { tools: { listChanged: true } } },
);

// NMP Plug & Play: Injects Authority MCP Prompts into the Stdio Bridge
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
		console.error(`\n======================================================`);
		console.error(`📥 [The Vault] Dynamic Injection Request Received.`);
		console.error(`======================================================`);

		// 1. The SDK Zero-Shot Middleware has already unpacked and purified it
		const logicCore = payload;
		console.error(
			`📥 [The Vault] Payload successfully passed Zero-Shot Format Check.`,
		);

		try {
			// 2. THE SHIELD - Phase 1: Zero-Time AST Guardian
			GuardianAST.inspect(logicCore);

			// 3. THE SHIELD - Phase 2: WASI Sandbox Execution
			const result = await WasiSandbox.execute(logicCore);

			// 4. THE SHIELD - Phase 3: Egress Filter (Anti-Exfiltration)
			// We review the mathematical output to ensure the AI doesn't try to steal an ID.
			try {
				const parsedOutput = JSON.parse(result.output);
				const stringifiedKeys = JSON.stringify(parsedOutput).toLowerCase();
				if (
					stringifiedKeys.includes('"id":') ||
					stringifiedKeys.includes('"patientid":')
				) {
					console.error(
						`\n🚨 [Egress Filter] FATAL: DATA EXFILTRATION ATTEMPT (PII) DETECTED!`,
					);
					console.error(
						`🚨 [Egress Filter] The computational output attempted to export patient identifiers.`,
					);
					throw new Error(
						"[NMP] Egress Security Violation. Output blocked due to PII leakage.",
					);
				}
			} catch (err: unknown) {
				const e = err as Error;
				if (e.message.includes("Egress Security Violation")) throw e;
				// If it's not JSON, let it pass or apply Regex for plain text according to the business rule.
			}

			console.error(
				`\n📤 [The Vault] Analysis completed. Returning ZK-Receipt to the issuer.`,
			);
			console.error(`======================================================\n`);

			// 4. Return the results and the STARK cryptographic receipt
			const responseData = {
				success: true,
				computation_result: result.output,
				security_metrics: {
					fuel_consumed: result.fuelConsumed,
					guardian_ast: "PASSED",
				},
				zk_receipt: result.zkReceipt,
			};

			return {
				content: [
					{ type: "text", text: JSON.stringify(responseData, null, 2) },
				],
			};
		} catch (error: unknown) {
			const e = error as Error;
			console.error(
				`\n🚫 [The Vault] EXECUTION ABORTED BY SECURITY PROTOCOLS.`,
			);
			console.error(`🚫 Reason: ${e.message}\n`);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: false,
								error: "VIOLETION_DETECTED",
								details: e.message,
							},
							null,
							2,
						),
					},
				],
				isError: true,
			};
		}
	},
);

// Register Discoverable Resources (Data Dictionary)
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
