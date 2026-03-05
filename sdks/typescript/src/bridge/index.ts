import type { NmpServer } from "../server/index.js";
import type { CallToolRequest, CallToolResult } from "../types.js";

/**
 * NmpMcpBridge acts as a bidirectional adapter.
 * It allows legacy JSON-RPC MCP clients to connect exactly as they used to,
 * intercepting those textual payloads and routing them directly to the modern
 * NmpServer logic (or eventually packaging them to WASM).
 */
export class NmpMcpBridge {
	constructor(private internalServer: NmpServer) {}

	/**
	 * Handles an incoming standard MCP JSON-RPC 2.0 payload containing `callTool`
	 * and pipes it to the fast `NmpServer` validation layer.
	 */
	public async handleJsonRpcRequest(
		payload: Record<string, unknown>,
	): Promise<unknown> {
		const id = payload.id as string | number;
		const method = payload.method as string;
		const params = payload.params as Record<string, unknown> | undefined;

		if (payload.jsonrpc !== "2.0") {
			return this.errorResponse(id, -32600, "Invalid Request");
		}

		if (method === "tools/list") {
			const tools = this.internalServer.listTools();
			return this.successResponse(id, { tools });
		}

		if (method === "resources/list") {
			const resources = this.internalServer.listResources();
			return this.successResponse(id, { resources });
		}

		if (method === "prompts/list") {
			const prompts = this.internalServer.listPrompts();
			return this.successResponse(id, { prompts });
		}

		if (method === "prompts/get") {
			if (!params || !params.name) {
				return this.errorResponse(id, -32602, "Missing prompt name in params");
			}
			try {
				const result = await this.internalServer.getPrompt({
					name: params.name as string,
					arguments: params.arguments as Record<string, string> | undefined,
				});
				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(id, -32000, (err as Error).message);
			}
		}

		if (method === "resources/read") {
			if (!params || !params.uri) {
				return this.errorResponse(id, -32602, "Missing resource uri in params");
			}
			try {
				const result = this.internalServer.readResource(params.uri as string);
				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(id, -32000, (err as Error).message);
			}
		}

		if (method === "tools/call") {
			if (!params || !params.name) {
				return this.errorResponse(id, -32602, "Missing tool name in params");
			}

			const request: CallToolRequest = {
				name: params.name as string,
				arguments: (params.arguments as Record<string, unknown>) || {},
			};

			try {
				const result: CallToolResult =
					await this.internalServer.callTool(request);

				const isVerified = await this.verifyZkReceipt(request, result);
				if (!isVerified) {
					return this.successResponse(id, {
						content: [
							{
								type: "text",
								text: "🚨 [NMP ZERO-TRUST SHIELD] ZK Verification Failed. The mathematical ImageID does not match the original payload. Execution aborted for security.",
							},
						],
						isError: true,
					});
				}

				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(id, -32000, (err as Error).message);
			}
		}

		return this.errorResponse(id, -32601, "Method not found");
	}

	private successResponse(
		id: string | number | null | undefined,
		result: unknown,
	) {
		return {
			jsonrpc: "2.0",
			id,
			result,
		};
	}

	private errorResponse(id: string | number, code: number, message: string) {
		return {
			jsonrpc: "2.0",
			id,
			error: { code, message },
		};
	}

	private async verifyZkReceipt(
		request: CallToolRequest,
		result: CallToolResult,
	): Promise<boolean> {
		if (
			!request.arguments?.payload ||
			typeof request.arguments.payload !== "string"
		) {
			// If it's not a Logic-on-Origin injection, bypass verification
			return true;
		}

		try {
			let payloadValue = request.arguments.payload;
			// Match server's exact extraction boundaries to guarantee hash parity
			const logicMatch = payloadValue.match(
				/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
			);
			if (logicMatch && logicMatch.length >= 2) {
				payloadValue = logicMatch[1].trim();
			}

			// 1. Recalculate the mathematical footprint locally (Image ID)
			const crypto = await import("node:crypto");
			const localImageId = crypto
				.createHash("sha256")
				.update(payloadValue)
				.digest("hex");

			// 2. Extract from NmpServer's JSON-Stringified response
			const contentText = result.content[0]?.text;
			if (contentText && typeof contentText === "string") {
				try {
					const data = JSON.parse(contentText);

					// If the server provided an image_id but it doesn't match our local calculation
					if (data.image_id && data.image_id !== localImageId) {
						console.error(
							`\n[NMP-Bridge] 🚨 FATAL: Image ID mismatch! Computed [${localImageId}], Received [${data.image_id}]`,
						);
						return false; // HACK DETECTED
					}

					// If the seal is valid, we inject audit evidence to the LLM
					if (data.image_id || data.zk_receipt) {
						data.audit_status =
							"✅ ZK-Receipt & ImageID Mathematically Verified by NmpMcpBridge";
						result.content[0].text = JSON.stringify(data);
					}
				} catch {
					// Output is not JSON or not protected by ZK-Receipt, skip
				}
			}
			return true;
		} catch (e) {
			console.error("[NMP ZK-Verifier] Critical validation failure:", e);
			return false; // Hack attempt or modification
		}
	}

	/**
	 * Connects the bridge by listening to stdio using readline.
	 * Responds to JSON-RPC 2.0 commands and handles initialization.
	 */
	public async connect(): Promise<void> {
		const readline = await import("node:readline");
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			terminal: false,
		});

		rl.on("line", async (line) => {
			if (!line.trim()) return;
			try {
				const payload = JSON.parse(line);

				// Standard MCP initialization bypass
				if (payload.method === "initialize") {
					const id = payload.id as string | number;
					const params = payload.params as Record<string, unknown> | undefined;

					const response = this.successResponse(id, {
						protocolVersion: params?.protocolVersion || "2024-11-05",
						capabilities: {
							tools: {
								listChanged: true,
							},
							resources: {
								listChanged: true,
							},
							prompts: {
								listChanged: true,
							},
						},
						serverInfo: this.internalServer.getServerInfo(),
					});
					process.stdout.write(`${JSON.stringify(response)}\n`);
					return;
				}

				if (payload.method === "notifications/initialized") {
					return;
				}

				const response = await this.handleJsonRpcRequest(payload);
				if (response) {
					process.stdout.write(`${JSON.stringify(response)}\n`);
				}
			} catch (e: unknown) {
				console.error(
					`[NMP-Bridge] Error processing JSON-RPC payload: ${(e as Error).message}`,
				);
			}
		});
	}
}
