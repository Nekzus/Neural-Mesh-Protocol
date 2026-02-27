import { Buffer } from "node:buffer";
import crypto from "node:crypto";
// @ts-ignore
import kyber from "crystals-kyber";
import { ASTGuardian } from "../sandbox/guardian.js";
import { WasiSandbox } from "../sandbox/wasi.js";

export interface WorkerData {
    ciphertext: Uint8Array;
    secretKeyObj: any;
    kyberPublicKey: Uint8Array;
    wasmBinary: Uint8Array;
    inputs: Record<string, Uint8Array>;
    sessionToken: string;
}

export default async function processLogicExecution(data: WorkerData): Promise<any> {
    const { ciphertext, secretKeyObj, kyberPublicKey, wasmBinary, inputs, sessionToken } = data;

    // 1. Decapsulate Kyber secret
    // Note: secretKeyObj is likely serialized, so we must reconstruct it or it might be passed as an array
    const sk = Array.from(secretKeyObj);
    const ct = Array.from(ciphertext);
    const sharedSecret = kyber.Decrypt768(ct, sk);
    const aesKey = Buffer.from(sharedSecret).subarray(0, 32);

    // 2. Decrypt Payload AES-256-GCM
    // We expect the wasmBinary to actually contain IV (12) + AuthTag (16) + Ciphertext if we follow the client logic
    const iv = wasmBinary.subarray(0, 12);
    const authTag = wasmBinary.subarray(12, 28);
    const encryptedPayload = wasmBinary.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(authTag);
    let decryptedWasm = decipher.update(encryptedPayload);
    decryptedWasm = Buffer.concat([decryptedWasm, decipher.final()]);

    // 3. Inspect AST with Guardian-TS
    const compiledModule = await WebAssembly.compile(decryptedWasm);
    ASTGuardian.analyze(compiledModule);

    // 4. Instantiate and Execute WASI Sandbox
    const sandbox = new WasiSandbox();
    const sandboxArgs = [
        "nmp-logic",
        `--session=${sessionToken}`,
    ];

    // Convert Uint8Array back to Buffer for WASI if needed
    await sandbox.execute(Buffer.from(decryptedWasm));

    // 5. Generate ZK Receipt Mock / Cryptographic Proof of Execution
    const hasher = crypto.createHash("sha256");
    hasher.update(decryptedWasm);
    const imageId = hasher.digest("hex");

    return {
        image_id: imageId,
        output: Buffer.from("Execution successful from Worker Pool").toString("base64")
    };
}
