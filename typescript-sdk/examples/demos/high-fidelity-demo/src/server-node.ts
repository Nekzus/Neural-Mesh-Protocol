// "The Vault" - Nodo de Datos NMP Hi-Fi
import { z } from "zod";
import { NmpServer } from "@neural-mesh/sdk/server";
import { GuardianAST } from "./lib/guardian-ast.js";
import { WasiSandbox } from "./lib/wasi-sandbox.js";

console.log("██████╗  █████╗ ███████╗███████╗");
console.log("██╔══██╗██╔══██╗██╔════╝██╔════╝");
console.log("██████╔╝███████║███████╗█████╗  ");
console.log("██╔══██╗██╔══██║╚════██║██╔══╝  ");
console.log("██████╔╝██║  ██║███████║███████╗");
console.log("╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝");
console.log(">>> THE VAULT (High-Fidelity NMP Server) is online.\n");

export const theVaultServer = new NmpServer(
    { name: "TheVault", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } }
);

theVaultServer.tool(
    "nmp_audit_sandbox",
    "Inyectar código WASM/JS remoto para análisis ciego sobre datos médicos sensibles. Protegido por Guardian AST y WASI Fuel.",
    {
        payload: z.string().describe("El string empaquetado del módulo Logic-on-Origin."),
    },
    async ({ payload }) => {
        console.log(`\n======================================================`);
        console.log(`📥 [The Vault] Solicitud de Inyección Dinámica Recibida.`);
        console.log(`======================================================`);

        // 1. Extraer la lógica pura del Payload (Parseo del Protocolo)
        const logicMatch = payload.match(/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/);
        if (!logicMatch || logicMatch.length < 2) {
            return {
                content: [{ type: "text", text: "Error: Payload malformado. Faltan magic bytes o boundaries de lógica." }],
                isError: true,
            };
        }

        const logicCore = logicMatch[1];
        console.log(`📥 [The Vault] Payload desempaquetado con éxito.`);

        try {
            // 2. THE SHIELD - Phase 1: Zero-Time AST Guardian
            GuardianAST.inspect(logicCore);

            // 3. THE SHIELD - Phase 2: WASI Sandbox Execution
            const result = await WasiSandbox.execute(logicCore);

            console.log(`\n📤 [The Vault] Análisis completado. Retornando ZK-Receipt al emisor.`);
            console.log(`======================================================\n`);

            // 4. Retornar los resultados y el recibo criptográfico STARK
            const responseData = {
                success: true,
                computation_result: result.output,
                security_metrics: {
                    fuel_consumed: result.fuelConsumed,
                    guardian_ast: "PASSED",
                },
                zk_receipt: result.zkReceipt
            };

            return {
                content: [{ type: "text", text: JSON.stringify(responseData, null, 2) }]
            };

        } catch (error: any) {
            console.error(`\n🚫 [The Vault] EJECUCIÓN ABORTADA POR PROTOCOLOS DE SEGURIDAD.`);
            console.error(`🚫 Motivo: ${error.message}\n`);

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "VIOLETION_DETECTED",
                        details: error.message
                    }, null, 2)
                }],
                isError: true,
            };
        }
    }
);
