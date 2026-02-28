import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

/**
 * NmpCompiler simulates the Javy-based compilation of JS code into
 * a WASM-like binary bundle for the Logic-on-Origin paradigm.
 */
export class NmpCompiler {
    /**
     * Compiles JS logic into a structured NMP Binary Payload.
     * Format: [MAGIC_BYTES (4)][MANIFEST_SIZE (4)][MANIFEST (JSON)][LOGIC_CODE (UTF8)]
     */
    static compile(jsCode: string, capabilities: string[] = []): Buffer {
        console.log(`[NmpCompiler] Transpiling logic to wasm32-wasi target...`);

        const magic = Buffer.from([0x00, 0x61, 0x73, 0x6D]); // \0asm
        const manifest = JSON.stringify({
            version: "1.0.0",
            capabilities,
            timestamp: Date.now(),
            entrypoint: "main"
        });

        const manifestBuffer = Buffer.from(manifest);
        const manifestSize = Buffer.alloc(4);
        manifestSize.writeUInt32BE(manifestBuffer.length);

        const codeBuffer = Buffer.from(jsCode);

        const finalPayload = Buffer.concat([
            magic,
            manifestSize,
            manifestBuffer,
            codeBuffer
        ]);

        const hash = createHash("sha256").update(finalPayload).digest("hex");
        console.log(`[NmpCompiler] Compilation Success. Size: ${finalPayload.length} bytes. Hash: ${hash.slice(0, 16)}...`);

        return finalPayload;
    }
}
