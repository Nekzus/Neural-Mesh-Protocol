// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP JWT Validator — Token Verification Engine
 *
 * Validates JWT Access Tokens using the `jose` library.
 * Supports two modes:
 *   - Local JWKS (Nexus role): Keys in memory, zero network latency.
 *   - Remote JWKS (Node role): Fetched from Nexus /oidc/jwks with 10min cache.
 *
 * Standards: NIST SP 800-207 (continuous verification), OWASP API-A01
 * Source: panva/jose DeepWiki — createRemoteJWKSet, jwtVerify
 */

import * as jose from "jose";
import { AUTH_DEFAULTS } from "./auth-config.js";

/**
 * Authorization context extracted from a validated JWT.
 * Compatible with MCP TypeScript SDK AuthInfo interface.
 */
export interface AuthInfo {
	/** Raw JWT string. */
	token: string;
	/** Subject claim (client_id for M2M flows). */
	clientId: string;
	/** Space-delimited scopes parsed into an array. */
	scopes: string[];
	/** Token expiration timestamp (Unix seconds). */
	expiresAt?: number;
}

/**
 * JWT Validator with dual-mode JWKS resolution.
 *
 * - Nexus role: `new JwtValidator(issuer, audience, localJwks)` (createLocalJWKSet)
 * - Node role: `new JwtValidator(issuer, audience, new URL(jwksUri))` (createRemoteJWKSet)
 */
export class JwtValidator {
	private readonly jwksResolver: ReturnType<
		typeof jose.createRemoteJWKSet | typeof jose.createLocalJWKSet
	>;
	private readonly issuer: string;
	private readonly audience: string;

	constructor(
		issuer: string,
		audience: string,
		jwksSource: URL | jose.JSONWebKeySet,
	) {
		this.issuer = issuer;
		this.audience = audience;

		if (jwksSource instanceof URL) {
			// Remote JWKS (node role): fetch from Nexus with intelligent caching.
			// jose docs: cacheMaxAge defaults to 10min, cooldownDuration to 30s.
			// These prevent JWKS endpoint abuse while keeping key rotation responsive.
			this.jwksResolver = jose.createRemoteJWKSet(jwksSource, {
				cacheMaxAge: AUTH_DEFAULTS.jwksCacheTtlMs,
				cooldownDuration: AUTH_DEFAULTS.jwksCooldownMs,
			});
		} else {
			// Local JWKS (nexus role): keys already loaded in memory.
			// Zero network latency for token validation on the issuing node.
			this.jwksResolver = jose.createLocalJWKSet(jwksSource);
		}
	}

	/**
	 * Validates a JWT access token and extracts authorization context.
	 *
	 * Checks performed (jose.jwtVerify):
	 * - Cryptographic signature verification (EdDSA or ES256)
	 * - Issuer claim matches configured issuer
	 * - Audience claim matches configured audience
	 * - Token is not expired (with clock tolerance for mesh skew)
	 * - Required claims (sub, scope) are present
	 *
	 * @throws JOSEError if validation fails (expired, wrong issuer, bad signature, etc.)
	 */
	async validate(token: string): Promise<AuthInfo> {
		// Build a comprehensive list of acceptable issuer aliases to handle
		// the Docker host/container networking mismatch. In the LIOP demo topology:
		//   - Nexus OAuth server runs inside Docker on port 3000
		//   - Docker hostname: "nexus" (from docker-compose.yml)
		//   - Container name: "liop-nexus"
		//   - Host-published ports: 13000 (HTTP), 13001 (libp2p)
		//   - The JWT `iss` claim is set by the Nexus to its own configured issuer
		//   - Nodes (Bank, Vault, Oracle) validate using their LIOP_NEXUS_URL
		//
		// All of these are equivalent endpoints for the same Authorization Server,
		// so any token issued by one alias must be accepted by a validator configured
		// with any other alias. Aligned with RFC 9728 Zero-Trust peer remapping.
		const issuers = this.buildIssuerAliases();

		const { payload } = await jose.jwtVerify(token, this.jwksResolver, {
			issuer: issuers.length > 1 ? issuers : this.issuer,
			audience: this.audience,
			// Algorithm whitelist: only accept EdDSA (Ed25519) or ES256.
			// Prevents algorithm confusion attacks (OWASP API-A01).
			algorithms: [AUTH_DEFAULTS.signingAlgorithm, "ES256"],
			// Clock tolerance for P2P mesh nodes with slight time drift.
			clockTolerance: AUTH_DEFAULTS.clockToleranceSec,
			// Enforce required claims to prevent malformed tokens.
			requiredClaims: ["sub", "scope"],
		});

		return {
			token,
			clientId: payload.sub ?? "unknown",
			scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
			expiresAt: payload.exp,
		};
	}

	/**
	 * Builds a complete set of issuer URL aliases for the LIOP demo topology.
	 *
	 * The LIOP mesh runs on Docker Desktop with the following network layout:
	 *   Container hostnames: "nexus", "liop-nexus" (internal port 3000)
	 *   Host-published ports: 13000 (HTTP/MCP), 13001 (libp2p TCP)
	 *   Loopback addresses: 127.0.0.1, localhost
	 *
	 * The Nexus OAuth server may set its issuer to any of these depending on
	 * how it was configured, and nodes may resolve it via LIOP_NEXUS_URL
	 * which varies by context. This method generates all equivalent aliases
	 * so that jose.jwtVerify accepts the token regardless of which alias
	 * was used as `iss` in the JWT.
	 *
	 * Security note: This does NOT weaken validation — the cryptographic
	 * signature is still verified against the same JWKS keys. Only the
	 * string comparison of the `iss` claim is relaxed across known aliases.
	 */
	private buildIssuerAliases(): string[] {
		const issuers = [this.issuer];
		const cleanIssuer = this.issuer.endsWith("/")
			? this.issuer.slice(0, -1)
			: this.issuer;

		// Known LIOP Nexus authority patterns (host:port).
		// If the configured issuer matches ANY of these, inject ALL others as aliases.
		const NEXUS_AUTHORITIES = [
			"nexus:3000",
			"liop-nexus:3000",
			"127.0.0.1:3000",
			"localhost:3000",
			"127.0.0.1:13000",
			"localhost:13000",
			"127.0.0.1:13001",
			"localhost:13001",
			"127.0.0.1:15000",
			"localhost:15000",
		];

		// Extract just the authority (host:port) from the issuer URL
		let issuerAuthority = "";
		try {
			const url = new URL(cleanIssuer);
			issuerAuthority = `${url.hostname}:${url.port || "3000"}`;
		} catch {
			// Non-URL issuer (e.g. "urn:..." or malformed) — skip aliasing
			return issuers;
		}

		// Check if the configured issuer matches any known Nexus authority
		const isNexusIssuer = NEXUS_AUTHORITIES.some(
			(authority) => issuerAuthority === authority,
		);

		if (!isNexusIssuer) return issuers;

		// Extract the path suffix (e.g., "/oidc" or "")
		const pathSuffix = cleanIssuer.replace(/^https?:\/\/[^/]+/, "");

		// Generate all alias permutations with the same path suffix
		for (const authority of NEXUS_AUTHORITIES) {
			const alias = `http://${authority}${pathSuffix}`;
			if (!issuers.includes(alias)) {
				issuers.push(alias);
			}
		}

		// Also add versions without the path suffix if it exists
		// (the Nexus default issuer is "http://localhost:3000" without "/oidc")
		if (pathSuffix) {
			for (const authority of NEXUS_AUTHORITIES) {
				const alias = `http://${authority}`;
				if (!issuers.includes(alias)) {
					issuers.push(alias);
				}
			}
		} else {
			// Conversely, add "/oidc" variants since some consumers include it
			for (const authority of NEXUS_AUTHORITIES) {
				const alias = `http://${authority}/oidc`;
				if (!issuers.includes(alias)) {
					issuers.push(alias);
				}
			}
		}

		return issuers;
	}

	/**
	 * Returns the configured issuer URL for PRM (RFC 9728) metadata.
	 */
	getIssuer(): string {
		return this.issuer;
	}

	/**
	 * Returns the configured audience for PRM metadata.
	 */
	getAudience(): string {
		return this.audience;
	}
}
