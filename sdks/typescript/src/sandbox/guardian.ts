// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

export class GuardianError extends Error {
	constructor(message: string) {
		super(`AST Sec-Policy Violation: ${message}`);
		this.name = "GuardianError";
	}
}

/**
 * The Guardian-TS Module
 * Scans the Abstract Syntax Tree (AST) imports of incoming WASM
 * before it reaches the V8 Wasmtime engine to prevent sandbox-escape
 * zero-days, resource exhaustion bombs, and evasive execution.
 */
export const ASTGuardian = {
	/**
	 * Analyzes the WebAssembly Module interface proactively.
	 *
	 * @param module - The compiled WebAssembly.Module to inspect
	 * @throws {GuardianError} If illegal imports or capabilities are detected
	 */
	analyze(module: WebAssembly.Module): void {
		const imports = WebAssembly.Module.imports(module);
		let _importCount = 0;

		const ALLOWED_WASI_FUNCTIONS = new Set([
			"fd_write",
			"fd_read",
			"fd_close",
			"fd_seek",
			"environ_get",
			"environ_sizes_get",
			"args_get",
			"args_sizes_get",
			"clock_time_get",
			"random_get",
			"proc_exit",
			"fd_prestat_get",
			"fd_prestat_dir_name",
			"fd_fdstat_get",
		]);

		for (const imp of imports) {
			// Strict Sandbox Validation: Only allow WASI preview 1 specific whitelisted functions.
			if (imp.module === "wasi_snapshot_preview1") {
				if (!ALLOWED_WASI_FUNCTIONS.has(imp.name)) {
					throw new GuardianError(
						`Banned WASI Import Detected: ${imp.module}/${imp.name}`,
					);
				}
			} else {
				throw new GuardianError(
					`Banned Host Import Module Detected: ${imp.module}`,
				);
			}
			_importCount++;

			if (_importCount > 128) {
				throw new GuardianError(
					"Import limit exceeded. Possible resource exhaustion attack.",
				);
			}
		}

		// In Node.js / V8, the maximum module size and function limits
		// are natively enforced by the engine during compilation.
		// A successfully compiled WebAssembly.Module already passed structural checks.
	},
};
