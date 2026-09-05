// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP RBAC Engine — Scope-Based Authorization
 *
 * Maps MCP JSON-RPC methods to required LIOP OAuth scopes.
 * Enforces least-privilege access at the router level before
 * any tool execution or resource read occurs.
 *
 * Standards: NIST SP 800-207 §4.3 (least privilege), OWASP LLM06 (Excessive Agency),
 *            OWASP API-A01 (Broken Access Control)
 */

import type { AuthInfo } from "./jwt-validator.js";

/**
 * Maps MCP JSON-RPC methods to the LIOP scopes required to invoke them.
 * Empty array = no authentication required (public endpoints).
 */
const SCOPE_MAP: Readonly<Record<string, readonly string[]>> = {
	// Protocol lifecycle — unauthenticated (MCP spec compliance)
	initialize: [],
	"notifications/initialized": [],
	"notifications/cancelled": [],
	ping: [],
	"server/discover": [],
	"subscriptions/listen": [],

	// Tool operations — require explicit authorization
	"tools/list": ["liop:tools:list"],
	"tools/call": ["liop:tools:call"],

	// Resource operations — read-level access
	"resources/list": ["liop:resources:read"],
	"resources/read": ["liop:resources:read"],
	"resources/templates/list": ["liop:resources:read"],

	// Prompt/schema operations — schema-level access
	"prompts/list": ["liop:schema:read"],
	"prompts/get": ["liop:schema:read"],
};

/**
 * Authorization result with optional denial reason for audit logging.
 */
export interface AuthorizationResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Evaluates whether a request is authorized based on JWT scopes.
 *
 * Decision logic:
 * 1. Methods with no required scopes (initialize, ping) → always allowed.
 * 2. Methods with required scopes but no auth → denied.
 * 3. Methods with required scopes → all scopes must be present in the JWT.
 * 4. Unknown methods with no auth → denied (fail-closed per NIST SP 800-207).
 *
 * @param method - MCP JSON-RPC method name (e.g., "tools/call")
 * @param auth - Validated JWT context, or null if unauthenticated
 * @param additionalScopes - Extra scopes required by specific node configuration
 */
export function authorizeRequest(
	method: string,
	auth: AuthInfo | null,
	additionalScopes?: readonly string[],
): AuthorizationResult {
	const methodScopes = SCOPE_MAP[method];

	// Methods explicitly marked as public (empty scope array) pass freely
	if (methodScopes !== undefined && methodScopes.length === 0) {
		return { allowed: true };
	}

	// If no auth context and method requires scopes → deny
	if (!auth) {
		return {
			allowed: false,
			reason: `Authentication required for method: ${method}`,
		};
	}

	// Merge method-level scopes with node-level additional scopes
	const needed = [...(methodScopes ?? []), ...(additionalScopes ?? [])];

	// If no scopes needed (unknown method, no additional) → fail-closed
	if (needed.length === 0) {
		return {
			allowed: false,
			reason: `Unknown method: ${method}. Access denied (fail-closed).`,
		};
	}

	// Verify all required scopes are present in the JWT
	const clientScopes = new Set(auth.scopes);
	const missing = needed.filter((s) => !clientScopes.has(s));

	if (missing.length > 0) {
		return {
			allowed: false,
			reason: `Insufficient scopes for ${method}. Missing: ${missing.join(", ")}`,
		};
	}

	return { allowed: true };
}

/**
 * All LIOP OAuth scopes supported by the protocol.
 * Used for PRM metadata and client registration.
 */
export const LIOP_SCOPES = [
	"liop:tools:list",
	"liop:tools:call",
	"liop:resources:read",
	"liop:schema:read",
	"liop:mesh:query",
] as const;

export type LiopScope = (typeof LIOP_SCOPES)[number];
