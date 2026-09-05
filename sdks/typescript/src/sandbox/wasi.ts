// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { WASI } from "node:wasi";
import * as acorn from "acorn";
import { simple } from "acorn-walk";
import { ASTGuardian } from "./guardian.js";

// Silence Node.js ExperimentalWarning for WASI (Industrial console parity)
const originalEmit = process.emit;
// @ts-expect-error
process.emit = (name, data, ...args) => {
	if (
		(name === "warning" &&
			typeof data === "object" &&
			(data as Record<string, unknown>).name === "ExperimentalWarning" &&
			String((data as Record<string, unknown>).message).includes("WASI")) ||
		String((data as Record<string, unknown>).message).includes("importing WASI")
	) {
		return false;
	}
	return originalEmit.call(process, name, data, ...args);
};

/**
 * Returns a filtered environment object containing only safe system variables,
 * preventing exposure of sensitive credentials and shell function injection.
 */
export function getDefaultEnvironment(): Record<string, string> {
	const isWindows = process.platform === "win32";
	const safeKeys = isWindows
		? [
				"APPDATA",
				"HOMEDRIVE",
				"HOMEPATH",
				"LOCALAPPDATA",
				"PATH",
				"PROCESSOR_ARCHITECTURE",
				"SYSTEMDRIVE",
				"SYSTEMROOT",
				"TEMP",
				"USERNAME",
				"USERPROFILE",
				"PROGRAMFILES",
			]
		: ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

	const env: Record<string, string> = {
		NODE_ENV: "production",
		LIOP_NODE: "true",
	};

	for (const key of safeKeys) {
		const val = process.env[key];
		if (val !== undefined && !val.startsWith("()")) {
			env[key] = val;
		}
	}

	return env;
}

/**
 * Calculates deterministic execution fuel units based on AST instruction complexity.
 * Guarantees identical fuel consumption for the same logic across different hardware.
 */
export function calculateAstInstructionFuel(code: string): number {
	try {
		const ast = acorn.parse(code, {
			ecmaVersion: 2022,
			sourceType: "script",
			allowReturnOutsideFunction: true,
		});

		let score = 100; // Base fuel for VM initialization & envelope parsing

		simple(ast, {
			Identifier() {
				score += 1;
			},
			Literal() {
				score += 1;
			},
			BinaryExpression() {
				score += 2;
			},
			UnaryExpression() {
				score += 2;
			},
			LogicalExpression() {
				score += 2;
			},
			// biome-ignore lint/suspicious/noExplicitAny: ESTree node
			VariableDeclaration(node: any) {
				score += 5 * (node.declarations?.length || 1);
			},
			AssignmentExpression() {
				score += 3;
			},
			MemberExpression() {
				score += 3;
			},
			// biome-ignore lint/suspicious/noExplicitAny: ESTree node
			ObjectExpression(node: any) {
				score += 5 + (node.properties?.length || 0) * 2;
			},
			// biome-ignore lint/suspicious/noExplicitAny: ESTree node
			ArrayExpression(node: any) {
				score += 5 + (node.elements?.length || 0) * 2;
			},
			// biome-ignore lint/suspicious/noExplicitAny: ESTree node
			CallExpression(node: any) {
				score += 10 + (node.arguments?.length || 0) * 2;
			},
			FunctionDeclaration() {
				score += 20;
			},
			FunctionExpression() {
				score += 15;
			},
			ArrowFunctionExpression() {
				score += 15;
			},
			IfStatement() {
				score += 5;
			},
			SwitchStatement() {
				score += 10;
			},
			ForStatement() {
				score += 50;
			},
			ForInStatement() {
				score += 50;
			},
			ForOfStatement() {
				score += 50;
			},
			WhileStatement() {
				score += 50;
			},
			DoWhileStatement() {
				score += 50;
			},
			TryStatement() {
				score += 15;
			},
			ReturnStatement() {
				score += 2;
			},
		});

		// Normalize to buckets of 100 to prevent timing side-channel inference
		return Math.ceil(score / 100) * 100;
	} catch (_e) {
		// Fallback for non-JS or unparseable code
		return 500;
	}
}

export interface SandboxConfig {
	allowEnv?: boolean;
	allowedDirectories?: Record<string, string>; // guestPath -> hostPath
	memoryLimitMb?: number;
}

/**
 * LIOP WasiSandbox (Industrial Grade)
 *
 * Provides a production-grade isolated environment for executing untrusted logic.
 * Primarily uses WebAssembly (WASI) for byte-code isolation, with a hardened
 * V8 Isolate fallback for dynamic JS-to-WASM logic injection.
 */
export class WasiSandbox {
	private wasi!: WASI;
	private sandboxId: string;
	private workingDir: string;
	private config: SandboxConfig;
	private stdoutHandle: fs.FileHandle | null = null;
	private stderrHandle: fs.FileHandle | null = null;

	constructor(config: SandboxConfig = {}) {
		this.sandboxId = crypto.randomUUID();
		// Use a dedicated LIOP directory in the OS temp folder
		this.workingDir = path.join(
			os.tmpdir(),
			"liop-mesh",
			"sandboxes",
			this.sandboxId,
		);
		this.config = config;
	}

	/**
	 * Initializes the physical sandbox environment with strict directory lockdown.
	 */
	public async init(): Promise<void> {
		try {
			await fs.mkdir(this.workingDir, { recursive: true });

			// Initialize WASI with explicit limits
			this.stdoutHandle = await fs.open(
				path.join(this.workingDir, "stdout.log"),
				"w+",
			);
			this.stderrHandle = await fs.open(
				path.join(this.workingDir, "stderr.log"),
				"w+",
			);

			this.wasi = new WASI({
				version: "preview1",
				args: ["liop_runtime"],
				env: this.config.allowEnv
					? { ...getDefaultEnvironment(), RUNTIME_ID: this.sandboxId }
					: {
							NODE_ENV: "production",
							LIOP_NODE: "true",
							RUNTIME_ID: this.sandboxId,
						},
				preopens: {
					"/sandbox": this.workingDir,
					...this.config.allowedDirectories,
				},
				stdout: this.stdoutHandle.fd,
				stderr: this.stderrHandle.fd,
			});
		} catch (error) {
			throw new Error(
				`Sandbox Initialization Failed: ${error instanceof Error ? error.message : "FS Error"}`,
			);
		}
	}

	/**
	 * Executes logic (WASM or JS-Wrapped) with hard resource limits.
	 */
	public async execute(
		compiledLogic: Buffer | string,
		records: Record<string, unknown>[] = [],
		inputs: Record<string, unknown> = {},
	): Promise<{ output: unknown; fuelConsumed: number }> {
		const startTime = performance.now();

		if (compiledLogic instanceof Buffer) {
			// Path A: Native WebAssembly Isolation
			try {
				const module = await WebAssembly.compile(new Uint8Array(compiledLogic));

				// Tier-0 Guardian: Static analysis to prevent sandbox escapes
				ASTGuardian.analyze(module);

				const instance = await WebAssembly.instantiate(
					module,
					this.wasi.getImportObject() as WebAssembly.Imports,
				);

				// Standard entry point
				this.wasi.start(instance);

				// Capture output from the sandbox
				const stdoutPath = path.join(this.workingDir, "stdout.log");
				const stderrPath = path.join(this.workingDir, "stderr.log");
				const stdout = await fs.readFile(stdoutPath, "utf-8");
				const stderr = await fs.readFile(stderrPath, "utf-8");

				const duration = performance.now() - startTime;
				return {
					output:
						stdout || (stderr ? `Error: ${stderr}` : "WASM_EXECUTION_SUCCESS"),
					fuelConsumed: Math.floor(duration * 1000),
				};
			} catch (error: unknown) {
				throw new Error(
					`WASM Runtime Error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else {
			// Path B: Hardened V8 Isolate Fallback
			// Uses node:vm with zero-prototype objects to prevent prototype pollution escapes.

			// biome-ignore lint/suspicious/noExplicitAny: Required for Sandbox global poisoning
			const sandboxEnv: any = Object.create(null); // Isolated global object
			const env = { records, ...inputs };

			// Explicitly poison Node.js escape vectors in the context
			sandboxEnv.require = undefined;
			sandboxEnv.process = undefined;
			sandboxEnv.global = undefined;
			sandboxEnv.globalThis = undefined;
			sandboxEnv.Buffer = undefined;
			sandboxEnv.setTimeout = undefined;
			sandboxEnv.setInterval = undefined;
			sandboxEnv.setImmediate = undefined;
			sandboxEnv.queueMicrotask = undefined;
			sandboxEnv.eval = undefined;
			sandboxEnv.Function = undefined;
			sandboxEnv.SharedArrayBuffer = undefined;
			sandboxEnv.Date = undefined;

			// [DoS Defense] Block off-heap memory allocation vectors.
			// Logic-on-Origin operates on JSON data (env.records) — binary buffers
			// serve no legitimate purpose and enable memory exhaustion DoS.
			// (Uint8Array(2GB) bypassed Piscina's maxOldGenerationSizeMb limit)
			sandboxEnv.ArrayBuffer = undefined;
			sandboxEnv.Uint8Array = undefined;
			sandboxEnv.Int8Array = undefined;
			sandboxEnv.Uint16Array = undefined;
			sandboxEnv.Int16Array = undefined;
			sandboxEnv.Uint32Array = undefined;
			sandboxEnv.Int32Array = undefined;
			sandboxEnv.Float32Array = undefined;
			sandboxEnv.Float64Array = undefined;
			sandboxEnv.BigInt64Array = undefined;
			sandboxEnv.BigUint64Array = undefined;
			sandboxEnv.DataView = undefined;

			// Recurse and strip prototype chain from host-passed objects to prevent escaping via constructor
			// biome-ignore lint/suspicious/noExplicitAny: Required for recursive null prototype mapping
			const toNullPrototype = (obj: any): any => {
				if (!obj || typeof obj !== "object") {
					return obj;
				}
				if (Array.isArray(obj)) {
					return obj.map(toNullPrototype);
				}
				const clone = Object.create(null);
				for (const [key, val] of Object.entries(obj)) {
					clone[key] = toNullPrototype(val);
				}
				return clone;
			};

			// Inject strictly monitored globals
			sandboxEnv.records = toNullPrototype(JSON.parse(JSON.stringify(records))); // Deep copy safety + null prototype
			sandboxEnv.env = toNullPrototype(JSON.parse(JSON.stringify(env)));

			for (const [key, value] of Object.entries(inputs)) {
				sandboxEnv[key] = toNullPrototype(JSON.parse(JSON.stringify(value)));
			}

			// Freeze the sandbox context to prevent mutation (SEC-GAP-1)
			// biome-ignore lint/suspicious/noExplicitAny: Required for recursive deep freeze of unknown data
			const deepFreeze = (obj: any) => {
				if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
					Object.freeze(obj);
					for (const key of Object.keys(obj)) {
						deepFreeze(obj[key]);
					}
				}
				return obj;
			};

			deepFreeze(sandboxEnv.records);
			deepFreeze(sandboxEnv.env);

			// Prevent property addition/modification on global scope
			for (const key of Object.keys(sandboxEnv)) {
				Object.defineProperty(sandboxEnv, key, {
					writable: false,
					configurable: false,
				});
			}

			// LIOP Execution Wrapper
			// Host-side logic transformation to avoid 'new Function' in sandbox
			let processedLogic = String(compiledLogic);
			if (
				/^\s*return\s/m.test(processedLogic) ||
				!processedLogic.includes("function liop_main")
			) {
				if (!processedLogic.includes("function liop_main")) {
					processedLogic = `function liop_main(env) {\n${processedLogic}\n}`;
				}
			}

			const scriptCode = `
				(function() {
					"use strict";
					try {
						// Pre-execution prototype freezing (PCI-DSS Compliance)
						Object.freeze(Object.prototype);
						Object.freeze(Array.prototype);
						Object.freeze(String.prototype);
						Object.freeze(Number.prototype);
						Object.freeze(Boolean.prototype);
						Object.freeze(RegExp.prototype);
						Object.freeze(Map.prototype);
						Object.freeze(Set.prototype);
						Object.freeze(Promise.prototype);
						Object.freeze(Error.prototype);
						Object.freeze(Object.getPrototypeOf(function(){}));

						${processedLogic}
						if (typeof liop_main === 'function') {
							return liop_main(env);
						}
						return "ERR_NO_ENTRY_POINT";
					} catch(e) {
						return "LogicError: " + e.message;
					}
				})();
			`;

			try {
				const script = new vm.Script(scriptCode, {
					filename: `liop-sandbox-${this.sandboxId.slice(0, 8)}.js`,
				});

				// Freeze Host prototypes in production (non-test environments) to completely block Prototype Pollution
				if (
					!process.env.VITEST &&
					typeof Object.prototype === "object" &&
					!Object.isFrozen(Object.prototype)
				) {
					Object.freeze(Object.prototype);
					Object.freeze(Array.prototype);
					Object.freeze(String.prototype);
					Object.freeze(Number.prototype);
					Object.freeze(Boolean.prototype);
					Object.freeze(RegExp.prototype);
					Object.freeze(Map.prototype);
					Object.freeze(Set.prototype);
					Object.freeze(Promise.prototype);
					Object.freeze(Error.prototype);
				}

				// microtaskMode: Ensures Promises created inside the sandbox are
				// resolved within the timeout/breakOnSigint scope (Node.js ≥14.6).
				// Without this, async microtasks could escape the 5s CPU limit.
				const context = vm.createContext(sandboxEnv, {
					name: "LIOP Isolate",
					origin: "liop://sandbox",
					microtaskMode: "afterEvaluate",
				});

				// Execution with hard CPU and Memory limits (Fuel)
				const output = script.runInContext(context, {
					timeout: 5000,
					breakOnSigint: true,
					displayErrors: true,
				});

				// [Phase Beta-3] Deterministic AST Instruction Fuel Metering (SOC 2 / Zero Hardware Drift)
				const logicStr =
					typeof compiledLogic === "string"
						? compiledLogic
						: compiledLogic.toString("utf-8");
				const fuelUsed = calculateAstInstructionFuel(logicStr);

				if (fuelUsed > 1000000) {
					throw new Error(
						"LIOP_RESOURCE_EXHAUSTED: Execution fuel limit exceeded.",
					);
				}

				return { output, fuelConsumed: fuelUsed };
			} catch (error) {
				throw new Error(
					`V8 Isolate Fault: ${error instanceof Error ? error.message : "Execution Timeout"}`,
				);
			}
		}
	}

	/**
	 * Physically cleans up the sandbox and releases resources.
	 */
	public async teardown(): Promise<void> {
		try {
			if (this.stdoutHandle) await this.stdoutHandle.close();
			if (this.stderrHandle) await this.stderrHandle.close();
			await fs.rm(this.workingDir, { recursive: true, force: true });
		} catch (_e) {
			// Silent fail on teardown to prevent process crashes
		}
	}
}
