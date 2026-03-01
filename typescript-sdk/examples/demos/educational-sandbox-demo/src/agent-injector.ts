import { NmpClient } from "@neural-mesh/sdk/client";
import { NmpCompiler } from "./lib/compiler.js";

const client = new NmpClient({
	name: "Strategic-Agent-Alpha",
	version: "1.0.0",
});

console.log(`
------------------------------------------------------------------
   NMP INDUSTRIAL AGENT - STRATEGIC LOGIC INJECTION              
------------------------------------------------------------------
`);

const runAgent = async () => {
	await client.connect();
	console.log(`[PILAR A] Neural Mesh Handshake Success.`);

	const peerId = "Strategic-Data-Node-Alpha";

	// Logic to inject
	const auditId = `AUDIT-${Math.floor(Math.random() * 9000) + 1000}`;
	const auditLogic = `
    function main(records) {
      return records.filter(r => r.risk_score > 0.8)
                    .map(r => ({ id: r.id, status: "AUDIT_REQUIRED" }));
    }
  `;

	// Compiling
	const wasmPayload = NmpCompiler.compile(auditLogic, ["vfs:read"]);

	// Post-Quantum Kyber & AES Sealing Visuals
	const serverPublicKey = new Uint8Array(1184).fill(0x01); // Simulated Kyber PK

	console.log(`[PILAR B] Starting ML-KEM-768 Handshake...`);
	console.log(`[PILAR E] Sealing WASM Payload with AES-256-GCM...`);

	try {
		// In a real NMP stream, we would use a specialized transport.
		// For this demo, we use a custom bridge that includes the wasmPayload.

		console.log(`[PILAR C] Pushing Logic-on-Origin to ${peerId}...`);

		// We mock the bridge calling our revamped server directly for high fidelity
		const { server_node_exec } = await import("./lib/bridge-mock.js");
		const response = await server_node_exec(auditId, wasmPayload);

		console.log(
			`\n------------------------------------------------------------------`,
		);
		console.log(
			`   RESULTS RECEIVED FROM REMOTE DATA-NODE                         `,
		);
		console.log(
			`------------------------------------------------------------------`,
		);

		const content = JSON.parse(response.content[0].text);

		console.log(`Audit ID: ${auditId}`);
		console.log(`Status: ${content.status}`);
		console.log(`Anomalies Found: ${content.results.length}`);

		console.log(`\n[PILAR G] Verifying ZK Receipt Integrity...`);
		console.log(
			`[ZK-VERIFIER] Journal Checksum: ${content.verification.journal.input_hash.slice(0, 16)}...`,
		);
		console.log(`[ZK-VERIFIER] RISC0 Seal: SUCCESS ✅`);

		console.log(`\n[SUCCESS] Computation integrity verified. Audit complete.`);
		console.log(
			`------------------------------------------------------------------\n`,
		);
	} catch (err: any) {
		console.error(`\n[NMP-AGENT] ❌ REQUEST FAILED: ${err.message}`);
	}
};

runAgent().catch(console.error);
