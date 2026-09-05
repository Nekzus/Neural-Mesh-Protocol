// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Embedded OAuth 2.1 Authorization Server
 *
 * Implements a lightweight, high-performance OAuth 2.1 / OIDC Authorization Server
 * for the Nexus node using `panva/node-oidc-provider`.
 *
 * Security Hardening:
 * - M2M (Machine-to-Machine) Client Credentials Grant ONLY (Zero human interaction interface).
 * - Algorithmic whitelist: EdDSA (Ed25519) for token signing.
 * - JWT Access Tokens: Allows stateless, cryptographically-secure validation on data nodes (NIST SP 800-207).
 * - Interaction Lockout: Throws exception on any interactive flow attempt to prevent hijack attacks (OWASP).
 *
 * Standards: OAuth 2.1, RFC 6749, RFC 7519, NIST SP 800-63B
 */

import crypto from "node:crypto";
import type * as jose from "jose";
// oidc-provider is a CommonJS module with a default export containing the Provider class
import Provider, { type Configuration } from "oidc-provider";
import { LIOP_SCOPES } from "./rbac.js";

export interface OAuthServerClientConfig {
	client_id: string;
	client_secret: string;
	grant_types: string[];
	scope: string;
}

export interface OAuthServerConfig {
	issuer: string;
	clients: OAuthServerClientConfig[];
}

export interface OAuthServerResult {
	provider: Provider;
	jwks: jose.JSONWebKeySet;
}

/**
 * Creates and configures the embedded node-oidc-provider instance for the Nexus.
 *
 * @param config - Server configuration containing the issuer URL and allowed M2M clients.
 */
export function createOAuthServer(
	config: OAuthServerConfig,
): OAuthServerResult {
	// 1. Generate Ed25519 (EdDSA) signing keys sychronously (zero network friction)
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
	const privateJwk = privateKey.export({ format: "jwk" }) as jose.JWK;
	const publicJwk = publicKey.export({ format: "jwk" }) as jose.JWK;
	const kid = crypto
		.createHash("sha256")
		.update(publicJwk.x || "")
		.digest("hex")
		.slice(0, 16);

	const privateJwkComplete = {
		...privateJwk,
		kid,
		use: "sig",
		alg: "EdDSA",
	};

	const publicJwkComplete = {
		...publicJwk,
		kid,
		use: "sig",
		alg: "EdDSA",
	};

	const jwksInternal = {
		keys: [privateJwkComplete],
	};

	const jwksPublic: jose.JSONWebKeySet = {
		keys: [publicJwkComplete],
	};

	// 2. Configure OpenID Connect Provider
	const oidcConfig: Configuration = {
		// Supported scopes at the Authorization Server level (RFC 6749)
		scopes: ["openid", "offline_access", ...LIOP_SCOPES],

		// Define registered Machine-to-Machine clients
		clients: config.clients.map((c) => ({
			client_id: c.client_id,
			client_secret: c.client_secret,
			grant_types: ["client_credentials"],
			response_types: [], // CC Grant does not use response types
			redirect_uris: [], // M2M flows require no redirects
			scope: c.scope,
			token_endpoint_auth_method: "client_secret_post",
			id_token_signed_response_alg: "EdDSA",
		})),

		// [SEC] Features whitelist: Enable Client Credentials, disable all human interactions
		features: {
			clientCredentials: { enabled: true },
			devInteractions: { enabled: false }, // Prevent development interactions UI
			resourceIndicators: {
				enabled: true,
				useGrantedResource: () => true,
				getResourceServerInfo: (_ctx, _resource, client) => {
					return {
						scope: client.scope || "",
						accessTokenFormat: "jwt",
						jwt: {
							sign: { alg: "EdDSA" },
						},
					};
				},
			},
		},

		// [SEC] Emit M2M Access Tokens as JWTs instead of opaque strings
		// This enables high-performance local validation at resource servers (NIST SP 800-207)
		formats: {
			AccessToken: "jwt",
			// biome-ignore lint/suspicious/noExplicitAny: library typings mismatch in oidc-provider
		} as any,

		// [SEC] Lockout: Throw immediate error on any interactive login flow attempt
		interactions: {
			url: () => {
				throw new Error(
					"InteractionsNotSupportedException: This Authorization Server is strictly configured for Machine-to-Machine flows.",
				);
			},
		},

		// Keys used for signing Issued Tokens (ID Tokens, Access Tokens)
		jwks: jwksInternal,

		// Token life configurations (NIST SP 800-63B token rotation guidelines)
		ttl: {
			ClientCredentials: 3600, // Access Token valid for 1 hour
		},

		// Allow HTTP locally for development/Docker testnets (production MUST use HTTPS in proxy)
		cookies: {
			keys: [crypto.randomBytes(32).toString("hex")],
		},

		// Map scopes directly into the JWT token claims during client_credentials grant
		extraTokenClaims: (_ctx, token) => {
			if (token.kind === "AccessToken") {
				return {
					scope: token.scope,
				};
			}
			return {};
		},
	};

	// Initialize the provider with normalized trailing slashes if needed
	// node-oidc-provider expects a clean URL as issuer
	const normalizedIssuer = config.issuer.endsWith("/")
		? config.issuer.slice(0, -1)
		: config.issuer;

	const provider = new Provider(normalizedIssuer, oidcConfig);

	// Make sure the provider trusts local proxies (like Nginx/Cloudflare or Docker network gateways)
	provider.proxy = true;

	return {
		provider,
		jwks: jwksPublic,
	};
}
