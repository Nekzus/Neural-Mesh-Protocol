import { WASI } from "node:wasi";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import crypto from "node:crypto";

export interface SandboxConfig {
    allowEnv?: boolean;
    allowedDirectories?: Record<string, string>; // guestPath -> hostPath
}

export class WasiSandbox {
    private wasi: WASI;
    private sandboxId: string;
    private workingDir: string;

    constructor(config: SandboxConfig = {}) {
        this.sandboxId = crypto.randomUUID();
        this.workingDir = path.join(os.tmpdir(), "nmp_sandbox", this.sandboxId);

        this.wasi = new WASI({
            version: "preview1",
            args: [],
            env: config.allowEnv ? process.env : { NMP_SANDBOX: "true" },
            preopens: {
                "/sandbox": this.workingDir,
                ...config.allowedDirectories,
            },
        });
    }

    /**
     * Initializes the physical sandbox directory
     */
    public async init(): Promise<void> {
        await fs.mkdir(this.workingDir, { recursive: true });
        console.log(`[WASI] Sandbox initialized at ${this.workingDir}`);
    }

    /**
     * Executes a given WebAssembly module safely
     */
    public async execute(wasmBytes: Buffer): Promise<void> {
        try {
            const module = await WebAssembly.compile(new Uint8Array(wasmBytes));
            const instance = await WebAssembly.instantiate(
                module,
                this.wasi.getImportObject() as any, // Injects safe WASI syscalls
            );

            // Start execution from the _start entry point
            this.wasi.start(instance);
        } catch (error: any) {
            throw new Error(`Execution failed inside Sandbox: ${error.message}`);
        }
    }

    /**
     * Cleans up the ephemeral sandbox environment
     */
    public async teardown(): Promise<void> {
        try {
            await fs.rm(this.workingDir, { recursive: true, force: true });
            console.log(`[WASI] Sandbox torn down: ${this.workingDir}`);
        } catch (e) {
            console.error(`Failed to teardown sandbox ${this.workingDir}`, e);
        }
    }
}
