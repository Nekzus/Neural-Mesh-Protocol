import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import kyber from "crystals-kyber";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(__dirname, "../../../../protocol/proto/nmp_core.proto");

export interface RpcClientConfig {
	targetAddress: string;
}

export class MeshRpcClient {
	// biome-ignore lint/suspicious/noExplicitAny: grpc client instanced dynamically
	private client: any;

	constructor(config: RpcClientConfig) {
		const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
			keepCase: true,
			longs: String,
			enums: String,
			defaults: true,
			oneofs: true,
		});

		const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic gRPC protocol mapping
		const nmp = (protoDescriptor as any).nmp.v1;

		this.client = new nmp.NeuralMesh(
			config.targetAddress,
			grpc.credentials.createInsecure(),
		);
	}

	public negotiateIntent(
		agentDid: string,
		capabilityHash: string,
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const req = {
				agent_did: agentDid,
				capability_hash: capabilityHash,
				proof_of_intent: Buffer.from("dummy-sig"),
			};

			this.client.NegotiateIntent(req, (err: unknown, response: unknown) => {
				if (err) return reject(err);
				resolve(response);
			});
		});
	}

	public executeLogic(
		sessionToken: string,
		kyberPublicKey: Buffer,
		wasmBinary: Buffer,
		inputs: Record<string, Buffer>,
	): Promise<unknown[]> {
		return new Promise((resolve, reject) => {
			try {
				// 1. PQC Encapsulation (ML-KEM-768)
				const c_ss = kyber.Encrypt768(kyberPublicKey);
				const pqcCiphertext = Buffer.from(c_ss[0]);
				const sharedSecret = Buffer.from(c_ss[1]);

				// 2. AES-256-GCM Symmetric Encryption
				const aesNonce = crypto.randomBytes(12);
				const cipher = crypto.createCipheriv(
					"aes-256-gcm",
					sharedSecret,
					aesNonce,
				);

				// Rust aes-gcm crate appends the AuthTag at the end of the ciphertext
				const encryptedWasm = Buffer.concat([
					cipher.update(wasmBinary),
					cipher.final(),
				]);
				const authTag = cipher.getAuthTag();
				const wasmBinaryWithTag = Buffer.concat([encryptedWasm, authTag]);

				const req = {
					session_token: sessionToken,
					wasm_binary: wasmBinaryWithTag,
					inputs: inputs,
					pqc_ciphertext: pqcCiphertext,
					aes_nonce: aesNonce,
				};

				const stream = this.client.ExecuteLogic(req);
				const chunks: unknown[] = [];

				stream.on("data", (chunk: unknown) => {
					chunks.push(chunk);
				});

				stream.on("end", () => {
					resolve(chunks);
				});

				stream.on("error", (err: unknown) => {
					reject(err);
				});
			} catch (err: unknown) {
				reject(err);
			}
		});
	}

	public close(): void {
		this.client.close();
	}
}
