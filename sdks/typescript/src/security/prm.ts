// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Protected Resource Metadata — RFC 9728
 *
 * Builds the JSON document served at /.well-known/oauth-protected-resource.
 * This enables MCP clients to discover the authorization server and
 * required scopes for accessing LIOP tools and resources.
 *
 * Standards: RFC 9728, MCP Spec 2025-11-25
 */

import { LIOP_SCOPES } from "./rbac.js";

/**
 * RFC 9728 Protected Resource Metadata response.
 *
 * @see https://datatracker.ietf.org/doc/rfc9728
 */
export interface ProtectedResourceMetadata {
	/** Identifier for the protected resource. */
	resource: string;
	/** Array of authorization server issuer URLs that can issue tokens for this resource. */
	authorization_servers: string[];
	/** OAuth scopes accepted by this resource. */
	scopes_supported: readonly string[];
	/** Methods of presenting the bearer token (always "header" for LIOP). */
	bearer_methods_supported: string[];
	/** URL to the resource documentation. */
	resource_documentation: string;
}

/**
 * Builds the Protected Resource Metadata document (RFC 9728).
 *
 * @param issuer - OIDC issuer URL of the Nexus authorization server
 * @param audience - JWT audience claim (resource identifier)
 */
export function buildProtectedResourceMetadata(
	issuer: string,
	audience: string,
): ProtectedResourceMetadata {
	return {
		resource: audience,
		authorization_servers: [issuer],
		scopes_supported: LIOP_SCOPES,
		bearer_methods_supported: ["header"],
		resource_documentation: "https://github.com/nekzus/liop",
	};
}
