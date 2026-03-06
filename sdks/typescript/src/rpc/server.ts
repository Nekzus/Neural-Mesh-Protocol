import * as grpc from "@grpc/grpc-js";
import { nmpV1 } from "./proto.js";
import type { IntentRequest, IntentResponse, LogicRequest, LogicResponse } from "./types.js";

/**
 * NMP gRPC Service Implementation
 * Handles intent negotiation and secure logic execution.
 */
export class NmpRpcServer {
	private server: grpc.Server;

	constructor() {
		this.server = new grpc.Server();
	}

	public addService(handlers: {
		negotiateIntent: (call: grpc.ServerUnaryCall<IntentRequest, IntentResponse>, callback: grpc.sendUnaryData<IntentResponse>) => void;
		executeLogic: (call: grpc.ServerWritableStream<LogicRequest, LogicResponse>) => void;
	}): void {
		this.server.addService(nmpV1.NeuralMesh.service, {
			NegotiateIntent: handlers.negotiateIntent,
			ExecuteLogic: handlers.executeLogic,
		});
	}

	public async listen(port: number = 50051): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server.bindAsync(
				`0.0.0.0:${port}`,
				grpc.ServerCredentials.createInsecure(), // Alpha: Insecure by default, PQC handled in payload
				(error, assignedPort) => {
					if (error) {
						reject(error);
						return;
					}
					this.server.start();
					console.error(`[NMP-RPC] Server listening on port ${assignedPort}`);
					resolve();
				}
			);
		});
	}

	public async stop(): Promise<void> {
		return new Promise((resolve) => {
			this.server.tryShutdown(() => {
				console.error("[NMP-RPC] Server shut down");
				resolve();
			});
		});
	}
}
