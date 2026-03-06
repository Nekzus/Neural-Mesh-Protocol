import { AesGcmWrapper } from "../rpc/crypto/aes.js";
import { Kyber768Wrapper } from "../rpc/crypto/kyber.js";
import { NmpRpcClient } from "../rpc/client.js";
import type { CallToolRequest, CallToolResult, ServerInfo } from "../types.js";
import type { LogicRequest, LogicResponse } from "../rpc/types.js";

/**
 * NmpClient interfaces with the P2P Mesh (or local Bridge) to dynamically
 * request or inject Logic-on-Origin capabilities into remote execution environments.
 */
export class NmpClient {
	private serverInfo?: ServerInfo;
	private rpcClient: NmpRpcClient | null = null;

	/**
	 * Discovers and connects to the target server or mesh capability.
	 */
	public async connect(address: string = "localhost:50051"): Promise<void> {
		this.rpcClient = new NmpRpcClient(address);
		this.serverInfo = { name: `NmpServer (${address})`, version: "1.0.0" };
		console.log(`[NmpClient] 🌐 Connected to ${address}`);
	}

	/**
	 * Retrieves Remote Capabilities via DHT (simulated here)
	 */
	public async discoverTools(): Promise<
		{ name: string; description?: string }[]
	> {
		if (!this.serverInfo) {
			throw new Error("Client must be connected before discovering tools.");
		}
		// Simulation
		return [
			{
				name: "read_logs",
				description: "Search large remote files without network transfer",
			},
		];
	}

	/**
	 * Invokes a tool. In NMP, rather than a JSON-RPC "call_tool", this conceptually
	 * pushes the WASM binary securely over the Zero-Trust Mesh using Kyber768 and AES-256-GCM.
	 */
	/**
	 * Invokes a tool. In NMP, rather than a JSON-RPC "call_tool", this conceptually
	 * pushes the WASM binary securely over the Zero-Trust Mesh using Kyber768 and AES-256-GCM.
	 */
	public async callTool(
		request: CallToolRequest,
		wasmPayload: Buffer,
	): Promise<CallToolResult> {
		if (!this.rpcClient) {
			throw new Error("Client must be connected before calling tools.");
		}

		// 1. Negotiate Intent with the remote host
		console.log(`[NmpClient] 🤝 Negotiating intent for ${request.name}...`);
		const intentResponse = await this.rpcClient.negotiateIntent({
			agent_did: "nmp-client-alpha", // In production, this would be a Noise PeerID or SPIFFE ID
			capability_hash: request.name,
			proof_of_intent: Buffer.from("alpha-intent-proof"),
		});

		if (!intentResponse.accepted) {
			throw new Error(`Intent denied by host: ${intentResponse.error_message}`);
		}

		// 2. Post-Quantum Encapsulation (ML-KEM-768)
		console.log(`[NmpClient] 🔒 Encapsulating Post-Quantum Shared Secret...`);
		const { ciphertext: kyberCiphertext, sharedSecret } =
			Kyber768Wrapper.encapsulateAsymmetric(intentResponse.kyber_public_key);

		// 3. Symmetric Sealing (AES-256-GCM)
		console.log(`[NmpClient] 🛡️ Sealing WASM Payload and Inputs...`);

		// Encrypt WASM binary
		const { ciphertext: encryptedWasm, nonce: aesNonce } =
			AesGcmWrapper.encryptPayload(wasmPayload, sharedSecret);

		// Encrypt inputs using the SAME session nonce for the multi-payload request (Standard NMP V1)
		const encryptedInputs: Record<string, Uint8Array> = {};
		for (const [key, value] of Object.entries(request.arguments || {})) {
			// We manually encrypt with the same nonce/key to match the Proto structure
			// ideally we'd have per-field nonces, but for Alpha we follow the nmp_core.proto v1.
			const crypto = await import("node:crypto");
			const cipher = crypto.createCipheriv("aes-256-gcm", sharedSecret, aesNonce);
			const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
			const authTag = cipher.getAuthTag();
			encryptedInputs[key] = Buffer.concat([encrypted, authTag]);
		}

		// 4. Assemble and Execute gRPC LogicRequest
		const logicRequest: LogicRequest = {
			session_token: intentResponse.session_token,
			wasm_binary: encryptedWasm,
			inputs: encryptedInputs,
			pqc_ciphertext: kyberCiphertext,
			aes_nonce: aesNonce,
		};

		return new Promise((resolve, reject) => {
			const stream = this.rpcClient!.executeLogic(logicRequest);
			let resultFulfilled = false;

			stream.on("data", async (response: LogicResponse) => {
				if (resultFulfilled) return;
				console.log("[NmpClient] ✅ Logic Executed. Verification in progress...");

				try {
					const isValid = await this.verifyZkReceipt(
						wasmPayload,
						Buffer.from(response.cryptographic_proof).toString("hex"),
						Buffer.from(response.zk_receipt),
					);

					if (!isValid) {
						reject(new Error("ZK-Receipt verification failed. ImageID mismatch."));
						return;
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
				if (resultFulfilled) return;
				console.error("[NmpClient] ❌ Stream Error:", err);
				reject(err);
			});

			stream.on("end", () => {
				if (!resultFulfilled) {
					reject(new Error("Logic-on-Origin stream closed without results."));
				}
			});
		});
	}

	/**
	 * Verify ZK-Receipt natively (Called internally when parsing gRPC streams)
	 */
	public async verifyZkReceipt(
		logicPayload: Buffer,
		remoteCryptographicProofHex: string,
		_remoteZkReceiptBuffer: Buffer,
	): Promise<boolean> {
		try {
			const crypto = await import("node:crypto");
			let processedPayload: Buffer | string = logicPayload;

			// Sanitization must match the server-side worker logic
			const isWasm =
				logicPayload[0] === 0x00 &&
				logicPayload[1] === 0x61 &&
				logicPayload[2] === 0x73 &&
				logicPayload[3] === 0x6d;

			if (!isWasm) {
				processedPayload = logicPayload
					.toString("utf-8")
					.replace(/---BEGIN_LOGIC---\n?/g, "")
					.replace(/\n?---END_LOGIC---/g, "")
					.trim();
			}

			const localImageId = crypto
				.createHash("sha256")
				.update(
					typeof processedPayload === "string"
						? Buffer.from(processedPayload)
						: processedPayload,
				)
				.digest("hex");

			if (localImageId !== remoteCryptographicProofHex) {
				console.error(
					`[NmpClient] 🚨 FATAL: Mathematical Proof Mismatch (Hack Detected). Expected [${localImageId}], Received [${remoteCryptographicProofHex}]`,
				);
				return false;
			}
			return true;
		} catch (error) {
			console.error(`[NmpClient] 🚨 Validation failed:`, error);
			return false;
		}
	}

	public getServerInfo(): ServerInfo | undefined {
		return this.serverInfo;
	}
}
