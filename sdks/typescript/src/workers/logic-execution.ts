import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import kyber from "crystals-kyber";
import { ASTGuardian } from "../sandbox/guardian.js";
import { WasiSandbox } from "../sandbox/wasi.js";

export interface WorkerData {
	ciphertext: Uint8Array;
	secretKeyObj: ArrayLike<number>;
	kyberPublicKey: Uint8Array;
	wasmBinary: Uint8Array; // Can also be JS code in non-encrypted mode
	inputs: Record<string, Uint8Array>;
	records?: Record<string, unknown>[];
	sessionToken: string;
	isEncrypted?: boolean;
}

export default async function processLogicExecution(
	data: WorkerData,
): Promise<{ image_id: string; output: string; fuel_consumed: number }> {
	const { ciphertext, secretKeyObj, wasmBinary, records, isEncrypted = true } = data;

	let decryptedPayload: Buffer | string;

	if (isEncrypted) {
		// 1. Decapsulate Kyber secret
		const sk = new Uint8Array(secretKeyObj);
		const ct = new Uint8Array(ciphertext);
		const sharedSecret = kyber.Decrypt768(ct, sk);
		const aesKey = Buffer.from(sharedSecret).subarray(0, 32);

		// 2. Decrypt Payload AES-256-GCM
		const iv = wasmBinary.subarray(0, 12);
		const authTag = wasmBinary.subarray(12, 28);
		const encryptedPayload = wasmBinary.subarray(28);

		const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
		decipher.setAuthTag(authTag);
		let decrypted = decipher.update(encryptedPayload);
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		decryptedPayload = decrypted;
	} else {
		// Transparent mode: payload is provided directly
		// If it's WASM (Magic bytes: \0asm), keep as Buffer
		if (wasmBinary[0] === 0x00 && wasmBinary[1] === 0x61 && wasmBinary[2] === 0x73 && wasmBinary[3] === 0x6d) {
			decryptedPayload = Buffer.from(wasmBinary);
		} else {
			decryptedPayload = Buffer.from(wasmBinary).toString("utf-8");
		}
	}

	// 3. Inspect AST with Guardian-TS (if WASM)
	const isWasm = decryptedPayload[0] === 0x00 && decryptedPayload[1] === 0x61 && decryptedPayload[2] === 0x73 && decryptedPayload[3] === 0x6d;

	if (decryptedPayload instanceof Buffer && isWasm) {
		// Ensure we pass a compatible BufferSource
		const wasmBytes = new Uint8Array(decryptedPayload);
		const compiledModule = await WebAssembly.compile(wasmBytes);
		ASTGuardian.analyze(compiledModule);
	} else if (decryptedPayload instanceof Buffer && !isWasm) {
		decryptedPayload = decryptedPayload.toString("utf-8");
	}

	// 4. Instantiate and Execute WASI Sandbox (or V8 Fallback)
	const sandbox = new WasiSandbox();
	await sandbox.init();

	try {
		const result = await sandbox.execute(decryptedPayload, records);

		// 5. Generate ZK Receipt Mock / Cryptographic Proof of Execution
		const hasher = crypto.createHash("sha256");
		hasher.update(decryptedPayload instanceof Buffer ? decryptedPayload : Buffer.from(decryptedPayload));
		const imageId = hasher.digest("hex");

		return {
			image_id: imageId,
			output: result.output,
			fuel_consumed: result.fuelConsumed
		};
	} finally {
		await sandbox.teardown();
	}
}
