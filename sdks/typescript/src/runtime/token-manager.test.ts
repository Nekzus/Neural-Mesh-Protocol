// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * TokenManager Test Suite — Adaptive OAuth 2.1 Lifecycle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenManager } from "./token-manager.js";

describe("TokenManager", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("should return static token immediately if provided", async () => {
		const manager = new TokenManager({
			tokenEndpoint: "http://localhost:15000/oidc/token",
			clientId: "test-client",
			clientSecret: "test-secret",
			staticToken: "static-jwt-token-123",
		});

		const token = await manager.getToken();
		expect(token).toBe("static-jwt-token-123");
		expect(manager.isExpired()).toBe(false);
	});

	it("should fetch and cache an M2M token from endpoint", async () => {
		let fetchCalls = 0;
		global.fetch = vi.fn().mockImplementation(async (url: string) => {
			fetchCalls += 1;
			expect(url).toBe("http://localhost:15000/oidc/token");
			return {
				ok: true,
				status: 200,
				json: async () => ({
					access_token: "dyn-jwt-token-abc",
					expires_in: 3600,
					token_type: "Bearer",
				}),
			} as Response;
		});

		const manager = new TokenManager({
			tokenEndpoint: "http://localhost:15000/oidc/token",
			clientId: "agent-m2m",
			clientSecret: "secret-abc",
			audience: "urn:liop:mesh:api",
		});

		const token1 = await manager.getToken();
		expect(token1).toBe("dyn-jwt-token-abc");
		expect(fetchCalls).toBe(1);

		// Second call should return cached token without fetching again
		const token2 = await manager.getToken();
		expect(token2).toBe("dyn-jwt-token-abc");
		expect(fetchCalls).toBe(1);
	});

	it("should invalidate token on demand", async () => {
		let tokenCount = 0;
		global.fetch = vi.fn().mockImplementation(async () => {
			tokenCount += 1;
			return {
				ok: true,
				status: 200,
				json: async () => ({
					access_token: `token-${tokenCount}`,
					expires_in: 3600,
				}),
			} as Response;
		});

		const manager = new TokenManager({
			tokenEndpoint: "http://localhost:15000/oidc/token",
			clientId: "agent-m2m",
			clientSecret: "secret-abc",
		});

		const firstToken = await manager.getToken();
		expect(firstToken).toBe("token-1");

		manager.invalidate();
		expect(manager.isExpired()).toBe(true);

		const secondToken = await manager.getToken();
		expect(secondToken).toBe("token-2");
	});

	it("should throw informative error on HTTP failure", async () => {
		global.fetch = vi.fn().mockImplementation(async () => {
			return {
				ok: false,
				status: 401,
				text: async () => "invalid_client",
			} as Response;
		});

		const manager = new TokenManager({
			tokenEndpoint: "http://localhost:15000/oidc/token",
			clientId: "bad-client",
			clientSecret: "bad-secret",
		});

		await expect(manager.getToken()).rejects.toThrow(
			"OAuth token request failed [HTTP 401]: invalid_client",
		);
	});
});
