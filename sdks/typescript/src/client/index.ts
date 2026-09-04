import { LiopVerifier } from "../crypto/verifier.js";
import {
	MCP_LEGACY_SUPPORT_ENABLED,
	MCP_PROTOCOL_VERSION_LEGACY,
} from "../gateway/mcp-compat.js";
import {
	type LiopManifest,
	MeshNode,
	type MeshNodeConfig,
} from "../mesh/node.js";
import { LiopRpcClient } from "../rpc/client.js";
import { AesGcmWrapper } from "../rpc/crypto/aes.js";
import { Kyber768Wrapper } from "../rpc/crypto/kyber.js";
import type { LiopTlsOptions } from "../rpc/tls.js";
import type { LogicRequest, LogicResponse } from "../rpc/types.js";
import { TokenManager } from "../runtime/token-manager.js";
import {
	type CallToolRequest,
	type CallToolResult,
	MCP_PROTOCOL_VERSION,
	type McpEra,
} from "../types.js";
import { log } from "../utils/logger.js";

/**
 * LIOP Client
 * High-level orchestration for discovery and execution in the Logic-Injection-on-Origin mesh.
 */
export class LiopClient {
	private meshNode: MeshNode | null = null;
	private rpcClients: Map<string, LiopRpcClient> = new Map();
	private manifests: Map<string, LiopManifest> = new Map();
	private tlsOptions?: LiopTlsOptions;
	private serverInfo?: { name: string; version: string };
	public verifier: LiopVerifier = new LiopVerifier();
	private oauthToken?: string;
	private tokenManager?: TokenManager;

	/** Protocol negotiation era */
	public era: McpEra = "modern";
	/** Negotiated protocol version */
	public protocolVersion: string = MCP_PROTOCOL_VERSION;

	constructor(tls?: LiopTlsOptions) {
		this.tlsOptions = tls;
	}

	/**
	 * Discovers and connects to the target server or mesh capability.
	 * If address is omitted, it sets up the MeshNode to act purely dynamically.
	 */
	public async connect(
		address?: string,
		options?: {
			meshConfig?: MeshNodeConfig;
			auth?: {
				clientId?: string;
				clientSecret?: string;
				nexusUrl?: string;
				audience?: string;
				scope?: string;
				token?: string;
			};
		},
	): Promise<void> {
		// Attempt to acquire OAuth M2M access token if credentials are provided
		const clientId =
			options?.auth?.clientId ||
			process.env.LIOP_OAUTH_CLIENT_ID ||
			process.env.LIOP_CLIENT_ID;
		const clientSecret =
			options?.auth?.clientSecret ||
			process.env.LIOP_OAUTH_CLIENT_SECRET ||
			process.env.LIOP_CLIENT_SECRET;
		const nexusUrl =
			options?.auth?.nexusUrl ||
			process.env.LIOP_NEXUS_URL ||
			"http://localhost:3000";
		const audience =
			options?.auth?.audience ||
			process.env.LIOP_OAUTH_AUDIENCE ||
			"urn:liop:mesh:api";
		const scope =
			options?.auth?.scope ||
			process.env.LIOP_OAUTH_SCOPE ||
			"liop:tools:call liop:tools:list liop:resources:read liop:schema:read liop:mesh:query";

		this.oauthToken =
			options?.auth?.token ||
			process.env.LIOP_OAUTH_TOKEN ||
			process.env.LIOP_TOKEN;

		if (clientId && clientSecret) {
			const baseUrl = (nexusUrl || "http://127.0.0.1:3000").endsWith("/oidc")
				? nexusUrl || "http://127.0.0.1:3000"
				: `${nexusUrl || "http://127.0.0.1:3000"}/oidc`;
			const tokenEndpoint = `${baseUrl}/token`;

			this.tokenManager = new TokenManager({
				tokenEndpoint,
				clientId,
				clientSecret,
				audience,
				scopes: scope,
			});

			try {
				this.oauthToken = await this.tokenManager.getToken();
				log.info(
					"[LiopClient] Dynamic TokenManager configured and initial token acquired.",
				);
			} catch (err: unknown) {
				log.error(
					`[LiopClient] Failed to acquire OAuth M2M Token: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				// In development or when using static local token, allow connection to proceed
			}
		}

		this.meshNode = new MeshNode(options?.meshConfig);
		await this.meshNode.start();
		log.info(
			`[LiopClient] Mesh Node synchronized. PeerID: ${this.meshNode.getPeerId()}`,
		);

		if (address) {
			const tokenResolver = async () => {
				if (this.tokenManager) {
					return await this.tokenManager.getToken();
				}
				return this.oauthToken;
			};
			this.rpcClients.set(
				"static",
				new LiopRpcClient(address, this.tlsOptions, tokenResolver),
			);
			this.serverInfo = { name: `LiopServer (${address})`, version: "1.0.0" };
			log.info(`[LiopClient] Static gRPC configured for: ${address}`);
		} else {
			this.serverInfo = { name: "LiopServer (Mesh Alpha)", version: "1.0.0" };
		}
	}

	/**
	 * Selects the optimal IP from an array of multiaddrs.
	 * Prioritizes routable non-loopback IPv4 addresses (e.g. Docker bridge, LAN, WAN)
	 * over loopback (127.0.0.1) to prevent inter-container connection failures.
	 */
	private selectOptimalIp(addrs: string[]): string | null {
		// Pass 1: Non-loopback, routable IPv4 addresses
		for (const maddr of addrs) {
			const parts = maddr.split("/");
			const ipIdx = parts.indexOf("ip4");
			if (ipIdx !== -1 && ipIdx + 1 < parts.length) {
				const ip = parts[ipIdx + 1];
				if (
					ip !== "127.0.0.1" &&
					!ip.startsWith("127.") &&
					ip !== "0.0.0.0" &&
					ip !== "localhost"
				) {
					return ip;
				}
			}
		}

		// Pass 2: Fallback to loopback if no external IP is announced
		for (const maddr of addrs) {
			const parts = maddr.split("/");
			const ipIdx = parts.indexOf("ip4");
			if (ipIdx !== -1 && ipIdx + 1 < parts.length) {
				return parts[ipIdx + 1];
			}
		}

		return null;
	}

	/**
	 * Dynamically queries Kademlia DHT to find the optimal PeerID providing the Capability
	 * and returns the physical gRPC target (host:port) resolved from the provider's manifest.
	 */
	public async resolveCapability(toolName: string): Promise<string> {
		if (!this.meshNode)
			throw new Error(
				"Client must be connected to Mesh to resolve capabilities.",
			);

		log.info(`[LiopClient] Querying Mesh DHT for Provider: ${toolName}...`);
		const providers = await this.meshNode.findProviders(toolName);

		if (providers.length === 0) {
			throw new Error(
				`Kademlia DHT found zero providers for capability: ${toolName}`,
			);
		}

		const providerId = providers[0];
		log.info(`[LiopClient] Identified Alpha Provider PeerID: ${providerId}`);

		let grpcPort = 50051;
		const manifest = await this.meshNode.queryManifest(providerId);
		if (manifest) {
			grpcPort = manifest.grpcPort;
			this.manifests.set(providerId, manifest);
			log.info(
				`[LiopClient] Manifest resolved: gRPC port ${grpcPort}. Cached manifest for PeerID ${providerId}`,
			);
		}

		const addrs = await this.meshNode.resolvePeer(providerId);
		const optimalIp = this.selectOptimalIp(addrs);
		if (optimalIp) {
			const grpcHost = `${optimalIp}:${grpcPort}`;
			log.info(
				`[LiopClient] Translated Multiaddr to optimal gRPC Target: ${grpcHost}`,
			);
			return grpcHost;
		}

		return `127.0.0.1:${grpcPort}`;
	}

	/**
	 * Probes a remote MCP endpoint using 'server/discover' to negotiate protocol era.
	 * Falls back to legacy initialize handshake if server/discover fails.
	 */
	public async probeServerDiscover(mcpUrl: string): Promise<{
		era: McpEra;
		protocolVersion: string;
		supportedVersions: string[];
	}> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"Mcp-Method": "server/discover",
			};
			if (this.oauthToken) {
				headers.Authorization = `Bearer ${this.oauthToken}`;
			}

			const res = await fetch(mcpUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "server/discover",
					params: {},
				}),
			});

			if (res.ok) {
				const json = (await res.json()) as {
					result?: { supportedVersions?: string[] };
				};
				const supported = json.result?.supportedVersions || [];
				if (supported.includes(MCP_PROTOCOL_VERSION)) {
					this.era = "modern";
					this.protocolVersion = MCP_PROTOCOL_VERSION;
					return {
						era: "modern",
						protocolVersion: MCP_PROTOCOL_VERSION,
						supportedVersions: supported,
					};
				}
			}
		} catch (_err) {
			// Ignore discovery network probe failures and fallback to legacy if enabled
		}

		/** @mcp-legacy Fallback to legacy era. Remove when v1 EOL. */
		if (MCP_LEGACY_SUPPORT_ENABLED) {
			this.era = "legacy";
			this.protocolVersion = MCP_PROTOCOL_VERSION_LEGACY;
			return {
				era: "legacy",
				protocolVersion: MCP_PROTOCOL_VERSION_LEGACY,
				supportedVersions: [MCP_PROTOCOL_VERSION_LEGACY],
			};
		}

		throw new Error(
			"Server does not support MCP 2026-07-28 and legacy support is disabled.",
		);
	}

	/**
	 * Discovers remote capabilities via the LIOP Manifest Protocol.
	 * Utilizes a memory cache to avoid redundant network dials against live peers.
	 */
	public async discoverTools(
		forceRefresh = false,
	): Promise<{ name: string; description?: string }[]> {
		if (!this.meshNode) {
			throw new Error("Client must be connected before discovering tools.");
		}

		log.info(
			`[LiopClient] Discovery started (forceRefresh: ${forceRefresh})...`,
		);
		const providerIds = await this.meshNode.discoverManifestProviders();
		const tools: { name: string; description?: string }[] = [];
		const seenNames = new Set<string>();

		for (const peerId of providerIds) {
			try {
				let manifest: LiopManifest | null | undefined = !forceRefresh
					? this.manifests.get(peerId)
					: undefined;

				if (!manifest) {
					log.info(`[LiopClient] Querying manifest from: ${peerId}`);
					manifest = await this.meshNode.queryManifest(peerId);
					if (manifest) {
						this.manifests.set(peerId, manifest);
					}
				} else {
					log.info(`[LiopClient] Using cached manifest for: ${peerId}`);
				}

				if (manifest) {
					for (const tool of manifest.tools) {
						if (!seenNames.has(tool.name)) {
							tools.push({ name: tool.name, description: tool.description });
							seenNames.add(tool.name);
						}
					}
				}
			} catch (err: unknown) {
				log.info(
					`[LiopClient] Error querying manifest from ${peerId}:`,
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		log.info(
			`[LiopClient] Discovery finished. Found ${tools.length} unique tools.`,
		);
		return tools;
	}

	/**
	 * Invokes a tool.
	 */
	public async callTool(
		request: CallToolRequest,
		_wasmPayload?: Buffer,
	): Promise<CallToolResult> {
		if (!this.meshNode) {
			throw new Error("Client must be connected before calling tools.");
		}

		const toolName = request.name;
		log.info(`[LiopClient] Resolving Tool: ${toolName}`);

		// [ALPHA-FIX] Bypass DHT discovery if we are already statically connected to a provider (Enterprise/Test mode)
		let rpcClient = this.rpcClients.get("static");
		let targetClientKey = toolName;

		if (!rpcClient) {
			// 1. If an RPC client was already registered for this toolName, reuse it
			if (this.rpcClients.has(toolName)) {
				rpcClient = this.rpcClients.get(toolName);
				targetClientKey = toolName;
			}
		}

		if (!rpcClient) {
			// 2. Fast-path: Check if capability already exists in cached manifests to bypass DHT walk
			let resolvedHost: string | null = null;
			for (const [peerId, manifest] of this.manifests.entries()) {
				if (manifest.tools.some((t) => t.name === toolName)) {
					// If we already have a client registered for this peerId, reuse it immediately
					if (this.rpcClients.has(peerId)) {
						rpcClient = this.rpcClients.get(peerId);
						targetClientKey = peerId;
						break;
					}

					const addrs = await this.meshNode.resolvePeer(peerId);
					const optimalIp = this.selectOptimalIp(addrs);
					if (optimalIp) {
						resolvedHost = `${optimalIp}:${manifest.grpcPort}`;
						log.info(
							`[LiopClient] Fast-path: Resolved ${toolName} from manifest cache to optimal target ${resolvedHost}`,
						);
						targetClientKey = peerId;
						rpcClient = this.getOrCreateRpcClient(peerId, resolvedHost);
						break;
					}
				}
			}

			if (!rpcClient) {
				const dynamicAddress = await this.resolveCapability(toolName);
				targetClientKey = toolName;
				rpcClient = this.getOrCreateRpcClient(toolName, dynamicAddress);
			}
		} else {
			targetClientKey = "static";
			log.info(
				`[LiopClient] Using existing static gRPC connection for ${toolName}.`,
			);
		}

		log.info(`[LiopClient] Negotiating intent for ${toolName}...`);
		const agentDid = this.meshNode
			? `did:liop:${this.meshNode.getPeerId()}`
			: "did:liop:ephemeral";
		const intentPayload = Buffer.from(`${toolName}:${Date.now()}`);
		const proofOfIntent = this.meshNode
			? await this.meshNode.sign(intentPayload)
			: intentPayload;

		let intentResponse: {
			accepted: boolean;
			error_message: string;
			kyber_public_key: Uint8Array;
			kyberPublicKey: Uint8Array;
			session_token: string;
			sessionToken: string;
		};

		try {
			intentResponse = (await rpcClient.negotiateIntent({
				agent_did: agentDid,
				capability_hash: toolName,
				proof_of_intent: proofOfIntent,
			})) as unknown as typeof intentResponse;
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (
				this.tokenManager &&
				(errMsg.includes("UNAUTHENTICATED") ||
					errMsg.includes("Invalid JWT") ||
					errMsg.includes("timestamp check failed") ||
					errMsg.includes("expired"))
			) {
				log.warn(
					`[LiopClient] Token expired/unauthenticated for ${toolName}. Preemptively refreshing OAuth token and retrying negotiateIntent...`,
				);
				this.tokenManager.invalidate();
				const freshToken = await this.tokenManager.getToken();
				this.oauthToken = freshToken;
				rpcClient.setToken(freshToken);
				intentResponse = (await rpcClient.negotiateIntent({
					agent_did: agentDid,
					capability_hash: toolName,
					proof_of_intent: proofOfIntent,
				})) as unknown as typeof intentResponse;
			} else {
				throw err;
			}
		}

		if (!intentResponse.accepted) {
			if (
				this.tokenManager &&
				(intentResponse.error_message?.includes("token") ||
					intentResponse.error_message?.includes("UNAUTHENTICATED") ||
					intentResponse.error_message?.includes("expired") ||
					intentResponse.error_message?.includes("timestamp check failed"))
			) {
				log.warn(
					`[LiopClient] Intent rejected with auth error: "${intentResponse.error_message}". Refreshing token and retrying...`,
				);
				this.tokenManager.invalidate();
				const freshToken = await this.tokenManager.getToken();
				this.oauthToken = freshToken;
				rpcClient.setToken(freshToken);
				intentResponse = (await rpcClient.negotiateIntent({
					agent_did: agentDid,
					capability_hash: toolName,
					proof_of_intent: proofOfIntent,
				})) as unknown as typeof intentResponse;
			}
			if (!intentResponse.accepted) {
				throw new Error(
					`Intent denied by host: ${intentResponse.error_message}`,
				);
			}
		}

		// LIOP Robust Field Extraction (Supports both snake_case and camelCase via gRPC-JS)
		const publicKey =
			intentResponse.kyber_public_key || intentResponse.kyberPublicKey;
		const sessionToken =
			intentResponse.session_token || intentResponse.sessionToken;

		if (!publicKey) {
			log.info(
				"[LiopClient] Critical Error: Kyber Public Key not found in IntentResponse.",
				intentResponse,
			);
			throw new Error(
				"Handshake failed: Remote host did not provide a valid Kyber Public Key.",
			);
		}

		// 2. Post-Quantum Encapsulation (ML-KEM-768)
		log.info(
			`[LiopClient] Encapsulating Post-Quantum Shared Secret for ${request.name}...`,
		);
		const { ciphertext: kyberCiphertext, sharedSecret } =
			await Kyber768Wrapper.encapsulateAsymmetric(publicKey);

		// 3. Symmetric Sealing (AES-256-GCM)
		log.info(`[LiopClient] Sealing WASM Payload and Inputs...`);

		const _safePayload = _wasmPayload || Buffer.from("");

		// Encrypt WASM binary
		const { ciphertext: encryptedWasm, nonce: aesNonce } =
			AesGcmWrapper.encryptPayload(_safePayload, sharedSecret);

		// Encrypt inputs using a fresh random nonce per input to prevent AES-GCM nonce reuse
		const encryptedInputs: Record<string, Uint8Array> = {};
		const crypto = await import("node:crypto");
		for (const [key, value] of Object.entries(request.arguments || {})) {
			const inputNonce = crypto.randomBytes(12);
			const cipher = crypto.createCipheriv(
				"aes-256-gcm",
				sharedSecret,
				inputNonce,
			);
			const encrypted = Buffer.concat([
				cipher.update(JSON.stringify(value)),
				cipher.final(),
			]);
			const authTag = cipher.getAuthTag();
			// Prepend the 12-byte nonce to the ciphertext
			encryptedInputs[key] = Buffer.concat([inputNonce, encrypted, authTag]);
		}

		// 4. Assemble and Execute gRPC LogicRequest
		const logicRequest: LogicRequest = {
			session_token: sessionToken,
			wasm_binary: encryptedWasm,
			inputs: encryptedInputs,
			pqc_ciphertext: kyberCiphertext,
			aes_nonce: aesNonce,
		};

		return new Promise((resolve, reject) => {
			const stream = rpcClient.executeLogic(logicRequest);
			if (!stream) {
				reject(new Error("RPC Client unavailable or failed to create stream."));
				return;
			}
			let resultFulfilled = false;
			let hasReceivedData = false;

			stream.on("data", async (response: LogicResponse) => {
				if (resultFulfilled) return;
				hasReceivedData = true;

				log.info("[LiopClient] Logic Executed. Verification in progress...");

				try {
					// Only verify ZK-Receipt if the remote execution succeeded.
					// If the remote execution failed due to a policy error (e.g. Egress Shield),
					// the ZK proof is empty and we should bypass validation to propagate the original error.
					if (!response.is_error) {
						const isValid = await this.verifier.verifyZkReceipt(
							_safePayload,
							Buffer.from(response.cryptographic_proof).toString("hex"),
							Buffer.from(response.zk_receipt),
							Buffer.from(sharedSecret),
							response.semantic_evidence,
						);

						if (!isValid) {
							reject(
								new Error(
									"PROTOCOL INTEGRITY VIOLATION: ZK-Receipt verification failed.",
								),
							);
							return;
						}
					}

					resultFulfilled = true;
					resolve({
						content: [
							{
								type: "text",
								text: response.semantic_evidence,
							},
						],
						isError: response.is_error,
					});
				} catch (err) {
					reject(err);
				}
			});

			stream.on("error", (err) => {
				// Evict faulted client from cache so subsequent requests reconnect cleanly
				this.rpcClients.delete(targetClientKey);
				this.rpcClients.delete(toolName);
				if (resultFulfilled) return;
				log.error("[LiopClient] Stream Error:", err);
				reject(err);
			});

			stream.on("end", () => {
				// We don't throw here if we already received a response block that is currently
				// undergoing ZK Verification in the Piscina worker pool.
				if (!hasReceivedData && !resultFulfilled) {
					reject(new Error("Logic-on-Origin stream closed without results."));
				}
			});
		});
	}

	private getOrCreateRpcClient(peerId: string, address: string): LiopRpcClient {
		let client = this.rpcClients.get(peerId);
		if (!client) {
			let manifest = this.manifests.get(peerId);
			let realPeerId = peerId;

			// If peerId is actually a toolName (which happens when called from callTool),
			// resolve the real PeerID and its manifest from the manifest cache.
			if (!manifest) {
				log.info(
					`[LiopClient] PeerID "${peerId}" not found in manifest cache as PeerID. Searching tools in cached manifests...`,
				);
				for (const [pId, m] of this.manifests.entries()) {
					if (m.tools.some((t) => t.name === peerId)) {
						manifest = m;
						realPeerId = pId;
						log.info(
							`[LiopClient] Resolved tool "${peerId}" to provider PeerID "${pId.slice(-8)}" from manifest cache.`,
						);
						break;
					}
				}
			}

			const providerName = manifest?.serverInfo?.name?.toLowerCase() || "";
			let envToken: string | undefined;

			// 0. Deterministic tokenSlug resolution (highest priority, zero heuristic)
			const slug = manifest?.tokenSlug;
			if (slug) {
				envToken =
					process.env[`LIOP_TOKEN_${slug}`] ||
					process.env[`LIOP_OAUTH_TOKEN_${slug}`];
				log.info(
					`[LiopClient] Resolved via tokenSlug "${slug}" (LIOP_TOKEN_${slug}) -> found: ${!!envToken}`,
				);
			} else {
				log.info(
					`[LiopClient] No tokenSlug available for peer ${realPeerId.slice(-8)}. Available cache keys: ${Array.from(
						this.manifests.keys(),
					)
						.map((k) => k.slice(-8))
						.join(", ")}`,
				);
			}

			// 1. PeerID-specific resolution: LIOP_TOKEN_<last 8 chars of PeerID in uppercase>
			if (!envToken && realPeerId) {
				const shortId = realPeerId.slice(-8).toUpperCase();
				envToken =
					process.env[`LIOP_TOKEN_${shortId}`] ||
					process.env[`LIOP_OAUTH_TOKEN_${shortId}`];
			}

			// 2. Provider-name resolution: LIOP_TOKEN_<CLEAN_PROVIDER_NAME_UPPERCASE>
			if (!envToken && providerName) {
				const cleanName = providerName
					.toUpperCase()
					.replace(/[^A-Z0-9_]/g, "_");
				envToken =
					process.env[`LIOP_TOKEN_${cleanName}`] ||
					process.env[`LIOP_OAUTH_TOKEN_${cleanName}`];
			}

			if (envToken) {
				log.info(
					`[LiopClient] Resolved node-specific token for peer ${realPeerId.slice(-8)} (${providerName || "unknown"})`,
				);
			}

			const tokenResolver = async () => {
				if (envToken) return envToken;
				if (this.tokenManager) {
					return await this.tokenManager.getToken();
				}
				return this.oauthToken;
			};

			client = new LiopRpcClient(address, this.tlsOptions, tokenResolver);
			this.rpcClients.set(peerId, client);
		}
		return client;
	}

	/**
	 * Reads a specific resource by URI.
	 * In LIOP, resources can be static definitions or dynamic streams.
	 */
	public async readResource(uri: string): Promise<{
		contents: Array<{ uri: string; mimeType?: string; text: string }>;
	}> {
		if (!this.meshNode) {
			throw new Error("Client must be connected before reading resources.");
		}
		log.info(`[LiopClient] Querying Mesh for Resource: ${uri}...`);

		// We search for the peer hosting the resource in the P2P Mesh
		const providers = await this.meshNode.findProviders(uri);
		if (providers.length === 0) {
			throw new Error(`No mesh providers found for resource: ${uri}`);
		}

		// Query the remote peer's manifest
		const manifest = await this.meshNode.queryManifest(providers[0]);
		if (!manifest) {
			throw new Error("Target peer did not return a valid LIOP Manifest.");
		}

		// Locate the exact resource metadata
		const resourceDef = manifest.resources?.find((r) => r.uri === uri);
		if (!resourceDef) {
			throw new Error(`Resource ${uri} not listed in remote manifest.`);
		}

		// Return the declarative metadata (Logic-Injection is required for actual data extraction)
		return {
			contents: [
				{
					uri,
					mimeType: resourceDef.mimeType || "application/json",
					text: JSON.stringify(resourceDef, null, 2),
				},
			],
		};
	}

	public getServerInfo(): { name: string; version: string } | undefined {
		return this.serverInfo;
	}

	/**
	 * Destroys the active Mesh Node resources.
	 */
	public async close(): Promise<void> {
		if (this.meshNode) {
			await this.meshNode.stop();
		}
	}
}
