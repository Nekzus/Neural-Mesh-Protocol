// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * Protocol Version Identifiers
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export {
	MCP_LEGACY_SUPPORT_ENABLED,
	MCP_PROTOCOL_VERSION_LEGACY,
} from "./gateway/mcp-compat.js";

/**
 * Protocol Era Classification
 */
export type McpEra = "legacy" | "modern";

/**
 * Caching Hints for MCP 2026-07-28 Spec
 */
export interface CacheableResult {
	ttlMs?: number;
	cacheScope?: "public" | "private";
}

/**
 * Multi-Round-Trip Requests (MRTR) Specification Types
 */
export interface InputRequest {
	id: string;
	message: string;
	schema?: Record<string, unknown>;
}

export interface InputResponse {
	id: string;
	value: unknown;
}

export interface InputRequiredResult {
	resultType: "input_required";
	inputRequests: InputRequest[];
	requestState?: string;
}

/**
 * Modern Envelope Metadata (_meta)
 */
export interface McpRequestMeta {
	"io.modelcontextprotocol/protocolVersion"?: string;
	"io.modelcontextprotocol/clientInfo"?: {
		name: string;
		version: string;
	};
	"io.modelcontextprotocol/clientCapabilities"?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Base Protocol Types representing parity with Model Context Protocol
 */

export const ToolSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	inputSchema: z.record(z.string(), z.unknown()), // Represents a JSON Schema
});

export type Tool = z.infer<typeof ToolSchema>;

export const ResourceSchema = z.object({
	uri: z.string(),
	name: z.string(),
	description: z.string().optional(),
	mimeType: z.string().optional(),
});

export type Resource = z.infer<typeof ResourceSchema>;

export const PromptSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	arguments: z
		.array(
			z.object({
				name: z.string(),
				description: z.string().optional(),
				required: z.boolean().optional(),
			}),
		)
		.optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

export interface CallToolRequest {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface CallToolResult {
	content: Array<{
		type: "text" | "image" | "resource";
		text?: string;
		data?: string;
		mimeType?: string;
		resource?: {
			uri: string;
			text?: string;
			blob?: string;
		};
	}>;
	isError?: boolean;
}

export interface GetPromptRequest {
	name: string;
	arguments?: Record<string, string>;
}

export interface GetPromptResult {
	description?: string;
	messages: Array<{
		role: "user" | "assistant";
		content:
			| { type: "text"; text: string }
			| { type: "image"; data: string; mimeType: string }
			| {
					type: "resource";
					resource: { uri: string; text?: string; blob?: string };
			  };
	}>;
}

export interface ServerInfo {
	name: string;
	version: string;
	capabilities?: {
		prompts?: { listChanged?: boolean };
		resources?: { subscribe?: boolean; listChanged?: boolean };
		tools?: { listChanged?: boolean };
		/** @mcp-legacy @deprecated Deprecated in MCP 2026-07-28 spec */
		logging?: Record<string, unknown>;
	};
}

export interface DiscoverResult {
	resultType: "complete";
	supportedVersions: string[];
	capabilities: ServerInfo["capabilities"];
	serverInfo: ServerInfo;
	instructions?: string;
}

export interface McpRequest {
	method: string;
	params?: unknown;
	id?: string | number | null;
	jsonrpc?: "2.0";
}

export interface McpResponse {
	jsonrpc: "2.0";
	id?: string | number | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

/**
 * Re-export AuthInfo from the security module for convenience.
 * Compatible with MCP TypeScript SDK AuthInfo interface shape.
 */
export type { AuthInfo } from "./security/jwt-validator.js";
