// "The Vault" - Nodo de Datos NMP Hi-Fi
import { z } from "zod";
import { NmpServer } from "@neural-mesh/sdk/server";
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

theVaultServer.tool(
	"nmp_audit_sandbox",
	"Inyectar código WASM/JS remoto para análisis ciego sobre datos médicos sensibles. Protegido por Guardian AST y WASI Fuel.",
	{
		payload: z
			.string()
			.describe("El string empaquetado del módulo Logic-on-Origin."),
	},
	async ({ payload }) => {
		console.error(`\n======================================================`);
		console.error(`📥 [The Vault] Solicitud de Inyección Dinámica Recibida.`);
		console.error(`======================================================`);

		// 1. Extraer la lógica pura del Payload (Parseo del Protocolo)
		const logicMatch = payload.match(
			/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
		);
		if (!logicMatch || logicMatch.length < 2) {
			return {
				content: [
					{
						type: "text",
						text: "Error: Payload malformado. Faltan magic bytes o boundaries de lógica.",
					},
				],
				isError: true,
			};
		}

		const logicCore = logicMatch[1];
		console.error(`📥 [The Vault] Payload desempaquetado con éxito.`);

		try {
			// 2. THE SHIELD - Phase 1: Zero-Time AST Guardian
			GuardianAST.inspect(logicCore);

			// 3. THE SHIELD - Phase 2: WASI Sandbox Execution
			const result = await WasiSandbox.execute(logicCore);

			// 4. THE SHIELD - Phase 3: Egress Filter (Anti-Exfiltration)
			// Revisamos la salida matemática para asegurarnos de que la IA no intente robar un ID.
			try {
				const parsedOutput = JSON.parse(result.output);
				const stringifiedKeys = JSON.stringify(parsedOutput).toLowerCase();
				if (stringifiedKeys.includes('"id":') || stringifiedKeys.includes('"patientid":')) {
					console.error(`\n🚨 [Egress Filter] FATAL: INTENTO DE EXFILTRACIÓN DE DATOS (PII) DETECTADO!`);
					console.error(`🚨 [Egress Filter] El resultado intentó exportar identificadores de pacientes.`);
					throw new Error("[NMP] Egress Security Violation. Output blocked due to PII leakage.");
				}
			} catch (e: any) {
				if (e.message.includes("Egress Security Violation")) throw e;
				// Si no es JSON, dejamos pasar o aplicamos Regex para texto plano según la regla de negocio.
			}

			console.error(
				`\n📤 [The Vault] Análisis completado. Retornando ZK-Receipt al emisor.`,
			);
			console.error(`======================================================\n`);

			// 4. Retornar los resultados y el recibo criptográfico STARK
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
		} catch (error: any) {
			console.error(
				`\n🚫 [The Vault] EJECUCIÓN ABORTADA POR PROTOCOLOS DE SEGURIDAD.`,
			);
			console.error(`🚫 Motivo: ${error.message}\n`);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: false,
								error: "VIOLETION_DETECTED",
								details: error.message,
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

// Registrar Recursos Descubribles (Diccionario de Datos)
theVaultServer.resource(
	"medical_records_schema",
	"nmp://schema/medical_records",
	`Esquema JSON estricto de la base de datos de pacientes (records).
	El entorno de la sandbox inyecta una variable global llamada 'env' que contiene 'env.records'.
	Cada objeto en el array 'records' sigue esta estructura:
	{
		"id": "string", // Identificador anonimizado del paciente (PII Sensible)
		"age": "number", // Edad del paciente en años
		"condition": "string", // Condición médica primaria (Healthy, Hypertension, Diabetes, etc.)
		"riskScore": "number" // Puntaje numérico de riesgo de 0.0 a 1.0 (Flotante)
	}`,
	"text/markdown"
);
