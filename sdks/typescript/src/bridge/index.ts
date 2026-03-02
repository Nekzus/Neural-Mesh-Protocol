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
				return this.errorResponse(
					id,
					-32602,
					"Missing prompt name in params",
				);
			}
			try {
				const result = await this.internalServer.getPrompt({
					name: params.name as string,
					arguments: params.arguments as Record<string, string> | undefined,
				});
				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(
					id,
					-32000,
					(err as Error).message,
				);
			}
		}

		if (method === "resources/read") {
			if (!params || !params.uri) {
				return this.errorResponse(
					id,
					-32602,
					"Missing resource uri in params",
				);
			}
			try {
				const result = this.internalServer.readResource(params.uri as string);
				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(
					id,
					-32000,
					(err as Error).message,
				);
			}
		}

		if (method === "tools/call") {
			if (!params || !params.name) {
				return this.errorResponse(
					id,
					-32602,
					"Missing tool name in params",
				);
			}

			const request: CallToolRequest = {
				name: params.name as string,
				arguments: (params.arguments as Record<string, unknown>) || {},
			};

			try {
				const result: CallToolResult =
					await this.internalServer.callTool(request);
				return this.successResponse(id, result);
			} catch (err: unknown) {
				return this.errorResponse(
					id,
					-32000,
					(err as Error).message,
				);
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
			} catch (e: unknown) {
				console.error(
					`[NMP-Bridge] Error processing JSON-RPC payload: ${(e as Error).message}`,
				);
			}
		});
	}
}
