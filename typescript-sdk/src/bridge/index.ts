import type { NmpServer } from "../server/index.js";
import type { CallToolRequest, CallToolResult } from "../types.js";

/**
 * NmpMcpBridge acts as a bidirectional adapter.
 * It allows legacy JSON-RPC MCP clients to connect exactly as they used to,
 * intercepting those textual payloads and routing them directly to the modern
 * NmpServer logic (or eventually packaging them to WASM).
 */
export class NmpMcpBridge {
	constructor(private internalServer: NmpServer) { }

	/**
	 * Handles an incoming standard MCP JSON-RPC 2.0 payload containing `callTool`
	 * and pipes it to the fast `NmpServer` validation layer.
	 */
	public async handleJsonRpcRequest(payload: any): Promise<any> {
		if (payload.jsonrpc !== "2.0") {
			return this.errorResponse(payload.id, -32600, "Invalid Request");
		}

		if (payload.method === "tools/list") {
			const tools = this.internalServer.listTools();
			return this.successResponse(payload.id, { tools });
		}

		if (payload.method === "resources/list") {
			const resources = this.internalServer.listResources();
			return this.successResponse(payload.id, { resources });
		}

		if (payload.method === "prompts/list") {
			const prompts = this.internalServer.listPrompts();
			return this.successResponse(payload.id, { prompts });
		}

		if (payload.method === "prompts/get") {
			const { params } = payload;
			if (!params || !params.name) {
				return this.errorResponse(
					payload.id,
					-32602,
					"Missing prompt name in params",
				);
			}
			try {
				const result = await this.internalServer.getPrompt({
					name: params.name,
					arguments: params.arguments,
				});
				return this.successResponse(payload.id, result);
			} catch (err: any) {
				return this.errorResponse(payload.id, -32000, err.message);
			}
		}

		if (payload.method === "resources/read") {
			const { params } = payload;
			if (!params || !params.uri) {
				return this.errorResponse(
					payload.id,
					-32602,
					"Missing resource uri in params",
				);
			}
			try {
				const result = this.internalServer.readResource(params.uri);
				return this.successResponse(payload.id, result);
			} catch (err: any) {
				return this.errorResponse(payload.id, -32000, err.message);
			}
		}

		if (payload.method === "tools/call") {
			const { params } = payload;
			if (!params || !params.name) {
				return this.errorResponse(
					payload.id,
					-32602,
					"Missing tool name in params",
				);
			}

			const request: CallToolRequest = {
				name: params.name,
				arguments: params.arguments || {},
			};

			try {
				const result: CallToolResult =
					await this.internalServer.callTool(request);
				return this.successResponse(payload.id, result);
			} catch (err: any) {
				return this.errorResponse(payload.id, -32000, err.message);
			}
		}

		return this.errorResponse(payload.id, -32601, "Method not found");
	}

	private successResponse(id: string | number, result: any) {
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

	/**
	 * Conecta el puente escuchando a stdio utilizando readline.
	 * Responde a los comandos JSON-RPC 2.0 y maneja la inicialización.
	 */
	public async connect(): Promise<void> {
		const readline = await import("readline");
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
					const response = this.successResponse(payload.id, {
						protocolVersion: payload.params?.protocolVersion || "2024-11-05",
						capabilities: {
							tools: {
								listChanged: true
							},
							resources: {
								listChanged: true
							},
							prompts: {
								listChanged: true
							}
						},
						serverInfo: this.internalServer.getServerInfo(),
					});
					console.log(JSON.stringify(response));
					return;
				}

				if (payload.method === "notifications/initialized") {
					return;
				}

				const response = await this.handleJsonRpcRequest(payload);
				if (response) {
					console.log(JSON.stringify(response));
				}
			} catch (e: any) {
				console.error(
					`[NMP-Bridge] Error procesando payload JSON-RPC: ${e.message}`,
				);
			}
		});
	}
}
