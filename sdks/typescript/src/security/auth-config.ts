// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP OAuth 2.1 Hybrid Auth — Configuration Types
 *
 * Defines the auth configuration interface consumed by LiopServerOptions.
 * Designed for zero-friction developer experience: most values auto-resolve.
 *
 * Standards: NIST SP 800-207, OWASP API-A07, MCP Spec 2025-11-25
 */

/**
 * Role of this node in the LIOP auth hierarchy.
 * - "nexus": Runs the embedded Authorization Server (oidc-provider) + Resource Server.
 * - "node": Resource Server only; validates JWTs issued by the Nexus.
 * - "none": Auth disabled (dev mode, stdio/local transport).
 */
export type AuthRole = "nexus" | "node" | "none";

/**
 * OAuth client registration for M2M (Client Credentials) flows.
 * Used exclusively by the Nexus role.
 */
export interface OAuthClientConfig {
	/** Unique identifier for the OAuth client. */
	client_id: string;
	/** Client secret for authentication (client_secret_post). */
	client_secret: string;
	/** OAuth grant types allowed for this client (e.g., ["client_credentials"]). */
	grant_types: string[];
	/** Space-delimited scopes this client can request. */
	scope: string;
}

/**
 * LIOP Auth Configuration.
 *
 * Minimal surface for developers:
 *   - Nexus node:  { role: "nexus" }
 *   - Data node:   { role: "node" }
 *   - Dev/stdio:   omit or { role: "none" }
 *
 * All other fields auto-resolve from env, DHT, or secure defaults.
 */
export interface LiopAuthConfig {
	/** Role of this node in the auth hierarchy. */
	role: AuthRole;
	/**
	 * OIDC Issuer URL. Auto-derived:
	 *   - Nexus: inferred from listen address (e.g., "http://localhost:3000")
	 *   - Node: resolved from Nexus /health endpoint
	 */
	issuer?: string;
	/**
	 * JWT audience claim.
	 * Default: "urn:liop:mesh:api"
	 */
	audience?: string;
	/**
	 * URL of the Nexus authorization server (node role only).
	 * Fallback: env.LIOP_NEXUS_URL → DHT auto-discovery.
	 */
	nexusUrl?: string;
	/**
	 * Required scopes for accessing this node's tools.
	 * Default: auto-derived from registered tools.
	 */
	requiredScopes?: string[];
	/**
	 * Pre-registered OAuth clients (nexus role only).
	 * Fallback: auto-detected from env.LIOP_OAUTH_CLIENT_ID + env.LIOP_OAUTH_CLIENT_SECRET.
	 */
	clients?: OAuthClientConfig[];
	/**
	 * Path to local token revocation JSON list (Resource Token Revocation List).
	 * Saved as an array of SHA-256 hashes of revoked access tokens.
	 */
	revocationPath?: string;
	/**
	 * Pre-shared local test token for isolated testing in non-production environments.
	 * A token matching this will bypass remote JWKS check only on this specific node.
	 */
	localTestToken?: string;
}

/**
 * Secure defaults for the OAuth subsystem.
 * Sources: NIST SP 800-207 §3.1, NIST SP 800-63B, OWASP API-A07
 */
export const AUTH_DEFAULTS = {
	/** JWT audience claim for the LIOP mesh API. */
	audience: "urn:liop:mesh:api",
	/** M2M token time-to-live in seconds (1 hour). */
	tokenTtlSeconds: 3600,
	/** JWKS cache TTL in milliseconds (10 min — jose default). */
	jwksCacheTtlMs: 600_000,
	/** Minimum interval between JWKS refetches (30s — jose default). */
	jwksCooldownMs: 30_000,
	/** Clock tolerance for JWT expiration checks (mesh clock skew). */
	clockToleranceSec: 5,
	/** JWT signing algorithm (aligned with libp2p Ed25519 PeerID curve). */
	signingAlgorithm: "EdDSA" as const,
} as const;
