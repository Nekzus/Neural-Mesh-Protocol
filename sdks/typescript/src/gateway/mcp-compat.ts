// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import type { McpRequest, McpResponse, ServerInfo } from "../types.js";

/**
 * @mcp-legacy ENTIRE FILE — MCP 2025-era backward compatibility layer.
 * Remove this file when MCP v1 (2025-11-25) reaches EOL.
 *
 * SUNSET INSTRUCTION: Delete this file, then grep for "@mcp-legacy" in the
 * codebase to find and remove all remaining legacy seams.
 */

/**
 * @mcp-legacy Master kill switch for MCP 2025-era backward compatibility.
 * Set to `false` when MCP v1 reaches End-of-Life (EOL) to disable all legacy seams.
 */
export const MCP_LEGACY_SUPPORT_ENABLED = true;

/**
 * @mcp-legacy Legacy protocol version constant.
 */
export const MCP_PROTOCOL_VERSION_LEGACY = "2025-11-25" as const;

/**
 * @mcp-legacy Build the legacy initialize handshake response.
 */
export function buildLegacyInitializeResponse(
	serverInfo: ServerInfo,
	id?: string | number | null,
): McpResponse {
	return {
		jsonrpc: "2.0",
		id: id ?? null,
		result: {
			protocolVersion: MCP_PROTOCOL_VERSION_LEGACY,
			capabilities: {
				tools: { listChanged: true },
				resources: { listChanged: true },
				prompts: { listChanged: true },
			},
			serverInfo,
		},
	};
}

/**
 * @mcp-legacy Detect if a request is strictly from a 2025-era legacy client.
 * Legacy requests either invoke 'initialize', 'notifications/initialized',
 * or lack modern '_meta' protocol envelopes.
 */
export function isLegacyRequest(request: McpRequest): boolean {
	if (
		request.method === "initialize" ||
		request.method === "notifications/initialized"
	) {
		return true;
	}

	const params = request.params as Record<string, unknown> | undefined;
	const meta = params?._meta as Record<string, unknown> | undefined;
	const version = meta?.["io.modelcontextprotocol/protocolVersion"];

	if (!version || version === MCP_PROTOCOL_VERSION_LEGACY) {
		return true;
	}

	return false;
}

/**
 * @mcp-legacy Wrap and strip modern-era fields (resultType, ttlMs, cacheScope, etc.)
 * from a response to ensure 100% wire-compatibility with strict 2025 MCP clients.
 */
export function adaptResponseForLegacyClient(
	response: McpResponse,
): McpResponse {
	if (!response.result || typeof response.result !== "object") {
		return response;
	}

	const rawResult = { ...(response.result as Record<string, unknown>) };

	// Strip modern-only envelope tags
	delete rawResult.resultType;
	delete rawResult.ttlMs;
	delete rawResult.cacheScope;

	return {
		...response,
		result: rawResult,
	};
}
