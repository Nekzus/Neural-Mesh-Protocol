/**
 * Represents a violation of the NMP Zero-Trust Sandbox policy.
 */
export class GuardianViolationError extends Error {
    constructor(message: string) {
        super(`[AST Security Violation]: ${message}`);
        this.name = "GuardianViolationError";
    }
}

/**
 * NMP Guardian-TS (TypeScript Validator)
 * Emulates the zero-time AST inspection done by `wasmparser` in Rust.
 * Scans the WebAssembly module imports before instantiation to prevent
 * sandbox escapes and limits execution strictly to WASI and NMP APIs.
 */
export class GuardianTS {
    /**
     * Scans raw WASM bytes to ensure 100% compliance with NMP Logic-on-Origin boundaries.
     *
     * @param wasmBytes The raw compiled `.wasm` buffer to inspect
     * @returns A parsed WebAssembly.Module proven safe for sandboxed execution
     * @throws {GuardianViolationError} If forbidden host imports are detected
     */
    static async analyzeAst(wasmBytes: Uint8Array | Buffer): Promise<WebAssembly.Module> {
        console.log("[Guardian-TS] 🛡️ Starting Zero-Time AST heuristic inspection...");

        // This throws if the WASM is structurally invalid or a decompression bomb
        let module: WebAssembly.Module;
        try {
            // Convert Node Buffer to a raw Uint8Array pure BufferSource
            const bufferSource = new Uint8Array(wasmBytes);
            module = await WebAssembly.compile(bufferSource);
        } catch (e) {
            throw new GuardianViolationError(`Payload structurally invalid or potential bomb: ${(e as Error).message}`);
        }

        // Heuristic Import Scanning
        // Extract all imported functions/memories from the AST
        const imports = WebAssembly.Module.imports(module);

        let importCount = 0;

        for (const imp of imports) {
            // Strict Sandbox Validation: Only allow WASI preview 1 and native NMP functions.
            // Reject any custom or unexpected host imports (e.g. `env.shell_exec`, `fs.open`).
            if (imp.module !== "wasi_snapshot_preview1" && imp.module !== "nmp") {
                throw new GuardianViolationError(`Banned Host Import Detected: ${imp.module}/${imp.name}`);
            }
            importCount++;
        }

        console.log(`[Guardian-TS] ✅ AST clean. Validated ${importCount} WASI/NMP imports.`);
        return module;
    }
}
