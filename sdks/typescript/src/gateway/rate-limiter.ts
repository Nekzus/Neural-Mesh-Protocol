// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Sliding-Window Rate Limiter
 *
 * High-performance, zero-dependency in-memory rate limiter designed
 * to protect the LIOP Hybrid Gateway and Mesh Nodes against Denial of Service (DoS),
 * worker pool exhaustion, and brute-force attacks.
 *
 * Conforms to OWASP API Security Top 10 (API4:2023 - Unrestricted Resource Consumption).
 */

export interface RateLimiterOptions {
	/** Window duration in milliseconds (default: 60,000ms = 1 minute) */
	windowMs?: number;
	/** Maximum number of allowed requests per window (default: 120) */
	maxRequests?: number;
}

export interface RateLimitStatus {
	allowed: boolean;
	remaining: number;
	limit: number;
	resetMs: number;
}

interface WindowRecord {
	count: number;
	resetTime: number;
}

export class InMemoryRateLimiter {
	private readonly windowMs: number;
	private readonly maxRequests: number;
	private readonly records: Map<string, WindowRecord> = new Map();
	private cleanupTimer?: NodeJS.Timeout;

	constructor(options: RateLimiterOptions = {}) {
		this.windowMs = options.windowMs ?? 60_000;
		this.maxRequests = options.maxRequests ?? 120;

		// Clean up expired buckets periodically (every 30s)
		this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
		if (typeof this.cleanupTimer.unref === "function") {
			this.cleanupTimer.unref();
		}
	}

	/**
	 * Evaluates whether a request from the given key (IP, token, or clientId) is permitted.
	 *
	 * @param key Identifier for the client (e.g., remote IP or OAuth client ID)
	 * @returns Status containing allowed boolean, remaining quota, and time until reset
	 */
	public check(key: string): RateLimitStatus {
		const now = Date.now();
		let record = this.records.get(key);

		if (!record || now >= record.resetTime) {
			record = {
				count: 1,
				resetTime: now + this.windowMs,
			};
			this.records.set(key, record);
			return {
				allowed: true,
				remaining: this.maxRequests - 1,
				limit: this.maxRequests,
				resetMs: this.windowMs,
			};
		}

		if (record.count >= this.maxRequests) {
			return {
				allowed: false,
				remaining: 0,
				limit: this.maxRequests,
				resetMs: Math.max(0, record.resetTime - now),
			};
		}

		record.count++;
		return {
			allowed: true,
			remaining: this.maxRequests - record.count,
			limit: this.maxRequests,
			resetMs: Math.max(0, record.resetTime - now),
		};
	}

	/**
	 * Explicitly resets the rate limit bucket for a given key.
	 */
	public reset(key: string): void {
		this.records.delete(key);
	}

	/**
	 * Cleans up expired rate-limiting buckets to prevent memory leaks.
	 */
	public cleanup(): void {
		const now = Date.now();
		for (const [key, record] of this.records.entries()) {
			if (now >= record.resetTime) {
				this.records.delete(key);
			}
		}
	}

	/**
	 * Destroys internal timers and clears records.
	 */
	public close(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		this.records.clear();
	}
}
