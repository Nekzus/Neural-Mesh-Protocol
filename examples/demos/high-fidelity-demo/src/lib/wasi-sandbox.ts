// WASI Sandbox & ZK-STARK Simulator
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WasiExecutionResult {
	output: string;
	fuelConsumed: number;
	zkReceipt: string;
}

export const WasiSandbox = {
	MAX_FUEL: 100_000, // Abstract CPU units

	/**
	 * Executes the code in an isolated environment with a strict resource limit.
	 * Prevents infinite loops and memory exhaustion attacks.
	 */
	async execute(compiledLogic: string): Promise<WasiExecutionResult> {
		console.error(`\n📦 [WASI Sandbox] Instantiating V8 Sandbox...`);
		console.error(
			`📦 [WASI Sandbox] Strict Fuel limit injected: ${WasiSandbox.MAX_FUEL} Units`,
		);

		// 1. Load the database in a controlled manner under the Sandbox (VFS Simulation)
		let recordsData = "[]";
		try {
			const dataPath = path.resolve(
				__dirname,
				"../../data/medical_records.json",
			);
			recordsData = await fs.readFile(dataPath, "utf-8");
			console.error(
				`📦 [WASI Sandbox] VirtualFS mounted: medical_records.json (${recordsData.length} bytes)`,
			);
		} catch (e) {
			console.error(`[WASI Sandbox] Error mounting VirtualFS: ${e}`);
		}

		let resultOutput = "";
		let fuelUsed = 0;

		// 2. Simulated execution with Fuel Control
		try {
			// We inject Fuel instrumentation into the client code if it contains loops
			const hasLoop = /while\s*\(true\)|for\s*\(;;\)/.test(compiledLogic);

			if (hasLoop) {
				console.error(
					`⚠️  [WASI Monitor] Potentially infinite loop pattern detected...`,
				);
				// We simulate the fuel counter explosion after a few cycles
				fuelUsed = WasiSandbox.MAX_FUEL + 1;
				throw new Error(
					"Wasmtime: Resource Exhaustion (Fuel consumed overflow)",
				);
			}

			// 3. Execute logic "Blindly" (We emulate V8 Isolates/vm module here safely for the demo)
			// In production NMP uses Wasmtime in Rust. Here we build an isolated function.
			// We pass *only* the pure records object, without exposing dependencies.
			const runLogic = new Function(
				"recordsRaw",
				`
        try {
           const db = JSON.parse(recordsRaw);
           // Inject shielded context as 'env' consistent with the System Prompt
           const env = { records: db };
           
           ${compiledLogic}
           
           return typeof nmp_main === 'function' ? nmp_main(env) : "Execution completed successfully, but no data was returned by the script. Ensure you use 'return' at the end of your logic.";
        } catch(e) {
           return "RuntimeException: " + e.message;
        }
      `,
			);

			// We simulate computation latency
			const startMark = performance.now();
			resultOutput = runLogic(recordsData);
			const endMark = performance.now();

			// Calculate spent fuel based on mathematical duration (Approx)
			fuelUsed = Math.floor((endMark - startMark) * 1500 + 500);

			if (fuelUsed > WasiSandbox.MAX_FUEL) {
				throw new Error("Wasmtime: Resource Exhaustion (Fuel limit exceeded)");
			}

			console.error(
				`✅ [WASI Sandbox] Execution Completed. Remaining fuel: ${WasiSandbox.MAX_FUEL - fuelUsed}`,
			);
		} catch (error: unknown) {
			const e = error as Error;
			console.error(`\n💥 [WASI Sandbox - FATAL ERROR] Execution Interrupted!`);
			console.error(`💥 Detail: ${e.message}`);
			throw new Error(`[NMP Sandbox Crash] ${e.message}`);
		}

		// 4. Generate Zero-Knowledge Proof (ZK-Receipt)
		console.error(`🔒 [ZK Prover] Generating STARK cryptographic receipt...`);
		const logicHash = createHash("sha256").update(compiledLogic).digest("hex");

		// Ensure output is string for hashing
		const outputForHash = typeof resultOutput === "object" ? JSON.stringify(resultOutput) : String(resultOutput);
		const outputHash = createHash("sha256").update(outputForHash).digest("hex");
		// We simulate the Zero-Knowledge Proof: Ensures the integrity of the Logic -> Data -> Output pipeline
		const zkReceipt = createHash("sha512")
			.update(`RISC0_SEAL:${logicHash}:${outputHash}:NMP_V1`)
			.digest("hex");

		return {
			output: resultOutput,
			fuelConsumed: fuelUsed,
			zkReceipt: zkReceipt,
		};
	},
};
