import { NmpServer } from "@neural-mesh/sdk/server";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "../data/medical_records.json");

const server = new NmpServer({
    name: "Production-Data-Node",
    version: "1.0.0"
});

// Rescatamos los datos locales que el servidor protege
const loadLocalData = async () => {
    const content = await fs.readFile(DATA_PATH, "utf-8");
    return JSON.parse(content);
};

// Registramos la herramienta de auditoría de forma nativa
server.tool(
    "audit_records",
    "Performs a secure multi-variable audit on protected medical records using logic-on-origin",
    {
        auditId: z.string(),
        minRisk: z.number().default(0.7)
    },
    async (params, context) => {
        console.log(`[NMP-SERVER] Logic-on-Origin received for Audit: ${params.auditId}`);

        // El SDK maneja internamente la seguridad, PQC y el Sandbox
        // Aquí simulamos el acceso seguro que el Sandbox tiene a los datos
        const data = await loadLocalData();

        console.log(`[NMP-SERVER] Executing logic over ${data.length} records...`);

        const anomalies = data.filter((r: any) => r.risk_score >= params.minRisk);

        // El SDK empaqueta el resultado y genera los recibos ZK automáticamente
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: "SUCCESS",
                        audit_id: params.auditId,
                        found_count: anomalies.length,
                        anomalies: anomalies.map((a: any) => ({ id: a.id, risk: a.risk_score }))
                    })
                }
            ],
            isError: false
        };
    }
);

console.log("------------------------------------------------------------------");
console.log("   NMP PRODUCTION SERVER - READY TO RECEIVE LOGIC                ");
console.log("------------------------------------------------------------------");

server.connectToMesh().catch(err => {
    console.error("Failed to start server:", err);
});
