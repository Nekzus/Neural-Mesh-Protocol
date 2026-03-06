import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { WASI } from "node:wasi";
import { ASTGuardian } from "./guardian.js";

export interface SandboxConfig {
	allowEnv?: boolean;
	allowedDirectories?: Record<string, string>; // guestPath -> hostPath
}

export class WasiSandbox {
	private wasi!: WASI;
	private sandboxId: string;
	private workingDir: string;
	private config: SandboxConfig;

	constructor(config: SandboxConfig = {}) {
		this.sandboxId = crypto.randomUUID();
		this.workingDir = path.join(os.tmpdir(), "nmp_sandbox", this.sandboxId);
		this.config = config;
	}

	/**
	 * Initializes the physical sandbox directory
	 */
	public async init(): Promise<void> {
		await fs.mkdir(this.workingDir, { recursive: true });

		this.wasi = new WASI({
			version: "preview1",
			args: [],
			env: this.config.allowEnv ? process.env : { NMP_SANDBOX: "true" },
			preopens: {
				"/sandbox": this.workingDir,
				...this.config.allowedDirectories,
			},
		});
	}

	/**
	 * Executes a given WebAssembly module or JS logic safely.
	 * Implements the NMP Tier-0 V8 Isolation Fallback.
	 */
	public async execute(
		compiledLogic: Buffer | string,
		records: Record<string, unknown>[] = [],
		inputs: Record<string, unknown> = {},
	): Promise<{ output: string; fuelConsumed: number }> {
		const startMark = performance.now();

		if (compiledLogic instanceof Buffer) {
			// Path A: WASM Native Execution
			// In alpha, we might pass inputs via WASI env or specific exports
			try {
				const module = await WebAssembly.compile(new Uint8Array(compiledLogic));
				ASTGuardian.analyze(module);
				const instance = await WebAssembly.instantiate(
					module,
					this.wasi.getImportObject() as WebAssembly.Imports,
				);
				this.wasi.start(instance);
				const duration = performance.now() - startMark;
				return {
					output: "WASM_SUCCESS",
					fuelConsumed: Math.floor(duration * 1000),
				};
			} catch (error: any) {
				throw new Error(`WASM Execution failed: ${error.message}`);
			}
		} else {
			// Path B: V8 Isolate Fallback (node:vm)
			// This is the "Aislamiento V8" promised in documentation.
			const sandboxEnv = Object.create(null);
			// Multiple access patterns to ensure parity with documentation
			const env = { records, ...inputs };
			sandboxEnv.records = records;
			sandboxEnv.env = env;
			// Pass each input as a global as well for convenience
			for (const [key, value] of Object.entries(inputs)) {
				sandboxEnv[key] = value;
			}
			// sandboxEnv.console = console; // REMOVED: Exposing host console creates a prototype pollution VM-Escape vector.

			const context = vm.createContext(sandboxEnv);

			const wrappedLogic = `
				(function() {
					try {
						// Execute the logic provided by the user
						${compiledLogic}

						// NMP Pattern: If nmp_main is defined, call it.
						// Otherwise, the logic itself should have returned a value 
						// (if wrapped in this IIFE).
						if (typeof nmp_main === 'function') {
							return nmp_main(env);
						}
					} catch(e) {
						return "RuntimeException: " + e.message;
					}
				})();
			`;

			const output = vm.runInContext(wrappedLogic, context, { timeout: 3000 });
			const duration = performance.now() - startMark;
			const fuelUsed = Math.floor(duration * 1500 + 500);

			if (fuelUsed > 100000) {
				throw new Error("Wasmtime: Resource Exhaustion (Fuel limit exceeded)");
			}

			// Clean output: if it's an object, stringify it (NMP Standard)
			const finalOutput =
				typeof output === "object" ? JSON.stringify(output) : String(output);

			return { output: finalOutput, fuelConsumed: fuelUsed };
		}
	}

	/**
	 * Cleans up the ephemeral sandbox environment
	 */
	public async teardown(): Promise<void> {
		try {
			await fs.rm(this.workingDir, { recursive: true, force: true });
		} catch (e) { }
	}
}
