import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

    constructor(config: RpcServerConfig) {
        this.config = config;
        this.server = new grpc.Server();

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

        callback(null, {
            accepted: true,
            session_token: "nmp_session_" + Date.now(),
            error_message: "",
            kyber_public_key: Buffer.from("dummy-kyber-key"),
        });
    }

    private executeLogic(call: grpc.ServerWritableStream<any, any>) {
        const request = call.request;
        console.log(`[gRPC] Executing Logic with token: ${request.session_token}`);

        // En la Fase 4 aquí pasaría el wasm_binary al Wasmtime/V8 Sandbox.
        // Simulamos un stream de respuesta NMP
        call.write({
            semantic_evidence: "Execution Dispatched successfully in Sandbox",
            cryptographic_proof: Buffer.from("dummy-sha256-proof"),
            zk_receipt: Buffer.from("dummy-zk-snark-receipt"),
        });

        call.end();
    }

    public async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const bindAddr = `${this.config.host}:${this.config.port}`;
            this.server.bindAsync(
                bindAddr,
                grpc.ServerCredentials.createInsecure(), // Todo: Reemplazar por mTLS o gRPC sobre QUIC Libp2p Mux
                (err, port) => {
                    if (err) return reject(err);
                    console.log(`NMP gRPC Server listening intensely on ${bindAddr}`);
                    resolve();
                },
            );
        });
    }

    public stop(): void {
        this.server.forceShutdown();
    }
}
