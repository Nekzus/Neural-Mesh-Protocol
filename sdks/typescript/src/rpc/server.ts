// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import * as grpc from "@grpc/grpc-js";
import { log } from "../utils/logger.js";
import { liopV1 } from "./proto.js";
import { createServerCredentials, type LiopTlsOptions } from "./tls.js";
import type {
	IntentRequest,
	IntentResponse,
	LogicRequest,
	LogicResponse,
} from "./types.js";

/**
 * LIOP gRPC Service Implementation
 * Handles intent negotiation and secure logic execution.
 */

import { GRPC_CHANNEL_OPTIONS } from "./channel-options.js";

export class LiopRpcServer {
	private server: grpc.Server;

	constructor() {
		this.server = new grpc.Server(GRPC_CHANNEL_OPTIONS);
	}

	public addService(handlers: {
		negotiateIntent: (
			call: grpc.ServerUnaryCall<IntentRequest, IntentResponse>,
			callback: grpc.sendUnaryData<IntentResponse>,
		) => void;
		executeLogic: (
			call: grpc.ServerWritableStream<LogicRequest, LogicResponse>,
		) => void;
	}): void {
		this.server.addService(liopV1.LogicMesh.service, {
			NegotiateIntent: handlers.negotiateIntent,
			ExecuteLogic: handlers.executeLogic,
		});
	}

	public async listen(
		port: number = 50051,
		tls?: LiopTlsOptions,
	): Promise<number> {
		const credentials = createServerCredentials(tls);
		return new Promise((resolve, reject) => {
			this.server.bindAsync(
				`0.0.0.0:${port}`,
				credentials,
				(error, assignedPort) => {
					if (error) {
						reject(error);
						return;
					}
					log.info(`[LIOP-RPC] Server listening on port ${assignedPort}`);
					resolve(assignedPort);
				},
			);
		});
	}

	public async gracefulShutdown(timeoutMs = 5000): Promise<void> {
		return new Promise((resolve) => {
			let resolved = false;
			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					log.warn(
						`[LIOP-RPC] tryShutdown timed out after ${timeoutMs}ms — forcing shutdown`,
					);
					this.server.forceShutdown();
					resolve();
				}
			}, timeoutMs);

			this.server.tryShutdown(() => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					log.info("[LIOP-RPC] Server gracefully shut down");
					resolve();
				}
			});
		});
	}

	public async stop(): Promise<void> {
		return this.gracefulShutdown(5000);
	}
}
