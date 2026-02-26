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
	public async handleJsonRpcRequest(payload: any): Promise<any> {
		if (payload.jsonrpc !== "2.0") {
			return this.errorResponse(payload.id, -32600, "Invalid Request");
		}

		if (payload.method === "tools/list") {
			const tools = this.internalServer.listTools();
			return this.successResponse(payload.id, { tools });
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
}
