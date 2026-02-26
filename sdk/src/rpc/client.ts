import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(__dirname, "../proto/nmp_core.proto");

export interface RpcClientConfig {
	targetAddress: string;
}

export class MeshRpcClient {
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
		const nmp = (protoDescriptor as any).nmp.v1;

		this.client = new nmp.NeuralMesh(
			config.targetAddress,
			grpc.credentials.createInsecure(),
		);
	}

	public negotiateIntent(
		agentDid: string,
		capabilityHash: string,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			const req = {
				agent_did: agentDid,
				capability_hash: capabilityHash,
				proof_of_intent: Buffer.from("dummy-sig"),
			};

			this.client.NegotiateIntent(req, (err: any, response: any) => {
				if (err) return reject(err);
				resolve(response);
			});
		});
	}

	public executeLogic(
		sessionToken: string,
		wasmBinary: Buffer,
		inputs: Record<string, Buffer>,
	): Promise<any[]> {
		return new Promise((resolve, reject) => {
			const req = {
				session_token: sessionToken,
				wasm_binary: wasmBinary,
				inputs: inputs,
				pqc_ciphertext: Buffer.from("kyber-enc"),
				aes_nonce: Buffer.from("12-byte-nonce"),
			};

			const stream = this.client.ExecuteLogic(req);
			const chunks: any[] = [];

			stream.on("data", (chunk: any) => {
				chunks.push(chunk);
			});

			stream.on("end", () => {
				resolve(chunks);
			});

			stream.on("error", (err: any) => {
				reject(err);
			});
		});
	}

	public close(): void {
		this.client.close();
	}
}
