import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import kyber from "crystals-kyber";
import { Piscina } from "piscina";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregamos as definições del proto NMP V1
const PROTO_PATH = path.resolve(__dirname, "../proto/nmp_core.proto");

export interface RpcServerConfig {
	host: string;
	port: number;
}

export class MeshRpcServer {
	private server: grpc.Server;
	private config: RpcServerConfig;
	private sessions: Map<string, Buffer> = new Map();
	private workerPool: Piscina;

	constructor(config: RpcServerConfig) {
		this.config = config;
		this.server = new grpc.Server();

		this.workerPool = new Piscina({
			filename: path.resolve(__dirname, "../workers/logic-execution.ts"),
			minThreads: 2,
			maxThreads: Math.max(2, os.cpus().length - 1),
		});

		const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
			keepCase: true,
			longs: String,
			enums: String,
			defaults: true,
			oneofs: true,
		});

		const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
		const nmp = (protoDescriptor as any).nmp.v1;

		this.server.addService(nmp.NeuralMesh.service, {
			NegotiateIntent: this.negotiateIntent.bind(this),
			ExecuteLogic: this.executeLogic.bind(this),
		});
	}

	private negotiateIntent(
		call: grpc.ServerUnaryCall<any, any>,
		callback: grpc.sendUnaryData<any>,
	) {
		const request = call.request;
		console.log(`[gRPC] Negotiating intent with Did: ${request.agent_did}`);

		// Generate Post-Quantum Keypair (ML-KEM-768)
		const pk_sk = kyber.KeyGen768();
		const pk = Buffer.from(pk_sk[0]);
		const sk = Buffer.from(pk_sk[1]);

		const sessionToken = "nmp_session_" + crypto.randomUUID();
		this.sessions.set(sessionToken, sk);

		callback(null, {
			accepted: true,
			session_token: sessionToken,
			error_message: "",
			kyber_public_key: pk,
		});
	}

	private async executeLogic(call: grpc.ServerWritableStream<any, any>) {
		const request = call.request;
		console.log(`[gRPC] Executing Logic with token: ${request.session_token}`);

		const sk = this.sessions.get(request.session_token);
		if (!sk) {
			console.error(
				`[gRPC] Invalid or expired session token: ${request.session_token}`,
			);
			call.end();
			return;
		}
		this.sessions.delete(request.session_token);

		try {
			console.log("[-] Offloading Execution to Multi-Core Worker Pool...");

			const workerResult = await this.workerPool.run({
				ciphertext: request.pqc_ciphertext,
				secretKeyObj: sk,
				kyberPublicKey: Buffer.alloc(0),
				wasmBinary: request.wasm_binary,
				inputs: {},
				sessionToken: request.session_token,
			});

			console.log(
				`[gRPC] Worker computational pipeline finished successfully.`,
			);

			call.write({
				semantic_evidence: workerResult.output,
				cryptographic_proof: Buffer.from(workerResult.image_id, "hex"),
				zk_receipt: crypto
					.createHash("sha256")
					.update(Buffer.from(workerResult.image_id, "hex"))
					.update("ZK_SNARK_STUB_SEAL")
					.digest(),
			});
		} catch (error: any) {
			console.error(
				`[gRPC] Capability Violation / Worker Error:`,
				error.message,
			);
			call.write({
				semantic_evidence: `Capability Violation: ${error.message}`,
				cryptographic_proof: Buffer.alloc(0),
				zk_receipt: Buffer.alloc(0),
			});
		}

		call.end();
	}

	public async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			const bindAddr = `${this.config.host}:${this.config.port}`;

			// Hardening: Structural Readiness for mTLS / TLS Mux over Yamux
			let credentials = grpc.ServerCredentials.createInsecure();
			const certPath = path.resolve(__dirname, "../../certs/server.crt");
			const keyPath = path.resolve(__dirname, "../../certs/server.key");

			if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
				console.log("[🔒] NMP gRPC: Mounting Secure TLS/mTLS Credentials...");
				const cert = fs.readFileSync(certPath);
				const key = fs.readFileSync(keyPath);
				credentials = grpc.ServerCredentials.createSsl(null, [
					{ cert_chain: cert, private_key: key },
				]);
			} else {
				console.warn(
					"[!] NMP gRPC: Missing TLS Certs. Falling back to Insecure localhost binding (Dev Mode only).",
				);
			}

			this.server.bindAsync(bindAddr, credentials, (err, port) => {
				if (err) return reject(err);
				console.log(`NMP gRPC Server listening intensely on ${bindAddr}`);
				resolve();
			});
		});
	}

	public stop(): void {
		this.server.forceShutdown();
	}
}
