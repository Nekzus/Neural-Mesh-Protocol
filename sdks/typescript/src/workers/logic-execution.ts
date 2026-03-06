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
	aesNonce?: Uint8Array;
}

export default async function processLogicExecution(
	data: WorkerData,
): Promise<{ image_id: string; output: string; fuel_consumed: number }> {
	const {
		ciphertext,
		secretKeyObj,
		wasmBinary,
		inputs,
		aesNonce,
		records,
		isEncrypted = true,
	} = data;

	let decryptedPayload: Buffer | string;
	const decryptedInputs: Record<string, unknown> = {};

	if (isEncrypted) {
		// 1. Decapsulate Kyber secret
		const sk = new Uint8Array(secretKeyObj);
		const ct = new Uint8Array(ciphertext);
		const sharedSecret = kyber.Decrypt768(ct, sk);
		// ML-KEM-768 produces a 32-byte shared secret directly compatible with AES-256
		const aesKey = Buffer.from(sharedSecret);

		// 2. Decrypt Main Payload (WASM/JS Code)
		// NMP Serialization: Ciphertext = EncryptedData + 16-byte AuthTag
		const wasmBuffer = Buffer.from(wasmBinary);
		const authTag = wasmBuffer.subarray(-16);
		const encryptedData = wasmBuffer.subarray(0, -16);

		const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(aesNonce || new Uint8Array(12)));
		decipher.setAuthTag(authTag);
		let decrypted = decipher.update(encryptedData);
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		decryptedPayload = decrypted;

		// 3. Decrypt Inputs
		for (const [key, encValue] of Object.entries(inputs || {})) {
			const valBuffer = Buffer.from(encValue);
			const valTag = valBuffer.subarray(-16);
			const valData = valBuffer.subarray(0, -16);

			const valDecipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(aesNonce || new Uint8Array(12)));
			valDecipher.setAuthTag(valTag);
			let valDecrypted = valDecipher.update(valData);
			valDecrypted = Buffer.concat([valDecrypted, valDecipher.final()]);
			decryptedInputs[key] = JSON.parse(valDecrypted.toString("utf-8"));
		}
	} else {
		// Transparent mode: payload is provided directly
		// If it's WASM (Magic bytes: \0asm), keep as Buffer
		if (
			wasmBinary[0] === 0x00 &&
			wasmBinary[1] === 0x61 &&
			wasmBinary[2] === 0x73 &&
			wasmBinary[3] === 0x6d
		) {
			decryptedPayload = Buffer.from(wasmBinary);
		} else {
			decryptedPayload = Buffer.from(wasmBinary).toString("utf-8");
		}
	}

	// 3. Inspect AST with Guardian-TS (if WASM)
	const isWasm =
		decryptedPayload[0] === 0x00 &&
		decryptedPayload[1] === 0x61 &&
		decryptedPayload[2] === 0x73 &&
		decryptedPayload[3] === 0x6d;

	if (decryptedPayload instanceof Buffer && isWasm) {
		// Ensure we pass a compatible BufferSource
		const wasmBytes = new Uint8Array(decryptedPayload);
		const compiledModule = await WebAssembly.compile(wasmBytes);
		ASTGuardian.analyze(compiledModule);
	} else if (decryptedPayload instanceof Buffer && !isWasm) {
		decryptedPayload = decryptedPayload.toString("utf-8");
	}

	// Sanitization: Remove NMP Logic Block markers if present (Common in documentation/The Vault prompts)
	if (typeof decryptedPayload === "string") {
		decryptedPayload = decryptedPayload
			.replace(/---BEGIN_LOGIC---\n?/g, "")
			.replace(/\n?---END_LOGIC---/g, "")
			.trim();
	}

	// 4. Instantiate and Execute WASI Sandbox (or V8 Fallback)
	const sandbox = new WasiSandbox();
	await sandbox.init();

	try {
		const result = await sandbox.execute(decryptedPayload, records, decryptedInputs);

		// 5. Generate ZK Receipt Mock / Cryptographic Proof of Execution
		const hasher = crypto.createHash("sha256");
		hasher.update(
			decryptedPayload instanceof Buffer
				? decryptedPayload
				: Buffer.from(decryptedPayload),
		);
		const imageId = hasher.digest("hex");

		return {
			image_id: imageId,
			output: result.output,
			fuel_consumed: result.fuelConsumed,
		};
	} finally {
		await sandbox.teardown();
	}
}
