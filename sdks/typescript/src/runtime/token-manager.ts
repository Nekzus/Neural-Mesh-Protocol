/**
 * LIOP Token Manager — Adaptive OAuth 2.1 M2M Token Lifecycle
 *
 * Implements resilient token caching with preemptive refresh (30s safety buffer),
 * concurrency de-duplication (single in-flight HTTP request), and on-demand
 * invalidation for 401 Unauthorized handling.
 *
 * Standards: RFC 6749, RFC 8707 (Resource Indicators), RFC 9068 (JWT Profile)
 */

import { log } from "../utils/logger.js";

export interface TokenManagerOptions {
	tokenEndpoint: string;
	clientId: string;
	clientSecret: string;
	audience?: string;
	scopes?: string | string[];
	staticToken?: string;
}

export class TokenManager {
	private cachedToken: string | null = null;
	private expiresAt = 0; // Epoch ms
	private pendingPromise: Promise<string> | null = null;

	private readonly tokenEndpoint: string;
	private readonly clientId: string;
	private readonly clientSecret: string;
	private readonly audience: string;
	private readonly scope: string;
	private readonly staticToken?: string;

	// Preemptive refresh threshold: 30 seconds before expiration
	private static readonly REFRESH_BUFFER_MS = 30_000;

	constructor(options: TokenManagerOptions) {
		this.tokenEndpoint = options.tokenEndpoint;
		this.clientId = options.clientId;
		this.clientSecret = options.clientSecret;
		this.audience = options.audience ?? "urn:liop:mesh:api";
		this.scope = Array.isArray(options.scopes)
			? options.scopes.join(" ")
			: (options.scopes ??
				"liop:tools:call liop:tools:list liop:resources:read liop:schema:read liop:mesh:query");
		this.staticToken = options.staticToken;
	}

	/**
	 * Returns a valid OAuth 2.1 access token.
	 * Automatically performs preemptive refresh if the token is close to expiry.
	 */
	public async getToken(): Promise<string> {
		if (this.staticToken) {
			return this.staticToken;
		}

		const now = Date.now();
		if (
			this.cachedToken &&
			now < this.expiresAt - TokenManager.REFRESH_BUFFER_MS
		) {
			return this.cachedToken;
		}

		if (this.pendingPromise) {
			return this.pendingPromise;
		}

		this.pendingPromise = (async () => {
			try {
				const token = await this.fetchNewToken();
				this.cachedToken = token;
				return token;
			} finally {
				this.pendingPromise = null;
			}
		})();

		return this.pendingPromise;
	}

	/**
	 * Force-invalidates cached token, e.g. after receiving a 401 Unauthorized response.
	 */
	public invalidate(): void {
		this.cachedToken = null;
		this.expiresAt = 0;
		log.info("[TokenManager] Cached OAuth access token invalidated.");
	}

	/**
	 * Returns true if the token is absent or has passed the refresh threshold.
	 */
	public isExpired(): boolean {
		if (this.staticToken) return false;
		return (
			!this.cachedToken ||
			Date.now() >= this.expiresAt - TokenManager.REFRESH_BUFFER_MS
		);
	}

	public getExpiresAt(): number {
		return this.expiresAt;
	}

	private async fetchNewToken(): Promise<string> {
		log.info(
			`[TokenManager] Requesting M2M token from ${this.tokenEndpoint} for client '${this.clientId}'...`,
		);

		const params = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: this.clientId,
			client_secret: this.clientSecret,
			resource: this.audience,
			scope: this.scope,
		});

		const response = await fetch(this.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: params.toString(),
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`OAuth token request failed [HTTP ${response.status}]: ${errorText}`,
			);
		}

		const data = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
			token_type?: string;
		};

		if (!data.access_token) {
			throw new Error(
				"OAuth token response did not contain an 'access_token' field.",
			);
		}

		const expiresInSec =
			typeof data.expires_in === "number" ? data.expires_in : 3600;
		this.expiresAt = Date.now() + expiresInSec * 1000;

		log.info(
			`[TokenManager] Acquired access token successfully. Expires in ${expiresInSec}s.`,
		);

		return data.access_token;
	}
}
