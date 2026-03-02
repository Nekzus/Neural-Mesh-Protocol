import type { Buffer } from "node:buffer";
import { NmpServer } from "@neural-mesh/sdk/server";
import { GuardianAST } from "./lib/guardian.js";
import { WasiSandbox } from "./lib/sandbox.js";

const server = new NmpServer({
	name: "Strategic-Data-Node-Alpha",
	version: "1.2.0-industrial",
});

console.log(`
------------------------------------------------------------------
   NMP INDUSTRIAL SERVER - LOGIC-ON-ORIGIN SANDBOX               
------------------------------------------------------------------
`);

// Register the tool
server.tool(
	"audit_patient_data",
	"Audits local patient records for high-risk conditions using injected WASM logic.",
	{
		auditId: { type: "string" },
	} as unknown as Record<string, import("zod").ZodTypeAny>, // Bypass strict zod shape for demo
	async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
		// In NMP, the wasmPayload comes in the gRPC stream.
		// For the demo, we assume it's attached to the execution context.
		const wasmPayload = extra.wasmPayload as Buffer;

		if (!wasmPayload) {
			throw new Error("Missing WASM Payload in Logic-on-Origin request.");
		}

		console.log(
			`\n[NMP-HOST] Incoming request: audit_patient_data (${args.auditId})`,
		);

		// 1. Security Gate: Guardian AST
		if (!GuardianAST.validate(wasmPayload)) {
			console.error(
				`[NMP-HOST] BLOCKING REQUEST: Security violation detected during pre-check.`,
			);
			throw new Error("SECURITY_VIOLATION: Forbidden patterns found in logic.");
		}

		// 2. Execution Gate: WASI Sandbox
		try {
			const { result, receipt } = await WasiSandbox.execute(wasmPayload, args);

			console.log(`[NMP-HOST] Emitting Proof of Execution (RISC0 Receipt)...`);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: "SUCCESS",
								results: result,
								verification: {
									zk_receipt: receipt,
									journal: receipt.journal,
								},
							},
							null,
							2,
						),
					},
				],
				isError: false,
			};
		} catch (err: unknown) {
			console.error(`[NMP-HOST] EXECUTION_TRAP: ${(err as Error).message}`);
			return {
				content: [{ type: "text", text: `Execution Error: ${(err as Error).message}` }],
				isError: true,
			};
		}
	},
);

const startServer = async () => {
	await server.connectToMesh();
	console.log(`[NMP-SDK] Strategic-Data-Node-Alpha active in DHT.`);
};

startServer().catch(console.error);
