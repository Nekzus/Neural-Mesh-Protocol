// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import * as grpc from "@grpc/grpc-js";
import { GRPC_CHANNEL_OPTIONS } from "./channel-options.js";
import { liopV1 } from "./proto.js";
import { createChannelCredentials, type LiopTlsOptions } from "./tls.js";
import type {
	IntentRequest,
	IntentResponse,
	LogicRequest,
	LogicResponse,
} from "./types.js";

export type TokenProvider =
	| string
	| (() => Promise<string | undefined> | string | undefined);

/**
 * LIOP gRPC Client Implementation
 * Provides a high-level interface for secure intent negotiation and logic execution.
 */
export class LiopRpcClient {
	// biome-ignore lint/suspicious/noExplicitAny: internal gRPC client type
	private client: any;
	private token?: TokenProvider;
	private lastResolvedToken?: string;
	public readonly address: string;

	constructor(address: string, tls?: LiopTlsOptions, token?: TokenProvider) {
		const credentials = createChannelCredentials(tls);
		this.client = new liopV1.LogicMesh(
			address,
			credentials,
			GRPC_CHANNEL_OPTIONS,
		);
		this.token = token;
		if (typeof token === "string") {
			this.lastResolvedToken = token;
		}
		this.address = address;
	}

	public setToken(token?: TokenProvider): void {
		this.token = token;
		if (typeof token === "string") {
			this.lastResolvedToken = token;
		}
	}

	private async resolveToken(): Promise<string | undefined> {
		if (typeof this.token === "function") {
			this.lastResolvedToken = await this.token();
			return this.lastResolvedToken;
		}
		this.lastResolvedToken = this.token;
		return this.token;
	}

	/**
	 * Negotiates intent with the remote host.
	 * Returns the ephemeral Kyber public key for payload encryption.
	 */
	public async negotiateIntent(
		request: IntentRequest,
	): Promise<IntentResponse> {
		const activeToken = await this.resolveToken();
		return new Promise((resolve, reject) => {
			const metadata = new grpc.Metadata();
			if (activeToken) {
				metadata.add("authorization", `Bearer ${activeToken}`);
			}
			this.client.NegotiateIntent(
				request,
				metadata,
				(error: grpc.ServiceError | null, response: IntentResponse) => {
					if (error) {
						reject(error);
					} else {
						resolve(response);
					}
				},
			);
		});
	}

	/**
	 * Pushes the encrypted Logic-on-Origin payload to the origin.
	 * Returns a stream of semantic responses and ZK proofs.
	 */
	public executeLogic(
		request: LogicRequest,
	): grpc.ClientReadableStream<LogicResponse> {
		const metadata = new grpc.Metadata();
		const activeToken =
			this.lastResolvedToken ||
			(typeof this.token === "string" ? this.token : undefined);
		if (activeToken) {
			metadata.add("authorization", `Bearer ${activeToken}`);
		}
		return this.client.ExecuteLogic(request, metadata);
	}

	public close(): void {
		this.client.close();
	}
}
