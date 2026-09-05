// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import type { MeshNode } from "../mesh/index.js";
import type { LiopServer } from "../server/index.js";
import { LiopMcpRouter } from "./router.js";

describe("LiopMcpRouter", () => {
	it("should return remote resource from manifest cache on resources/read fallback", async () => {
		const mockServer = {
			getServerInfo: () => ({ name: "test", version: "1" }),
			listTools: () => [],
			listResources: () => [],
			readResource: () => {
				throw new Error("Resource not found locally");
			},
		} as unknown as LiopServer;

		const mockMeshNode = {
			registerManifestHandler: vi.fn(),
			announceManifest: vi.fn().mockResolvedValue(true),
			getPeerId: () => "local-peer",
		} as unknown as MeshNode;

		const router = new LiopMcpRouter(mockServer, mockMeshNode);

		// Inject mock data into manifestCache using any cast to access private field
		// biome-ignore lint/suspicious/noExplicitAny: testing private field
		(router as any).manifestCache = new Map([
			[
				"remote-peer-id",
				{
					cachedAt: Date.now(),
					manifest: {
						peerId: "remote-peer-id",
						grpcPort: 1234,
						tools: [],
						resources: [
							{
								name: "Remote Schema",
								uri: "liop://remote/schema",
								description: "A remote test schema",
								mimeType: "application/json",
								text: '{"foo": "bar"}',
							},
						],
						serverInfo: { name: "Remote", version: "1" },
					},
				},
			],
		]);

		const response = await router.dispatch({
			method: "resources/read",
			params: { uri: "liop://remote/schema" },
			id: 1,
		});

		expect(response).not.toBeNull();
		// biome-ignore lint/suspicious/noExplicitAny: test payload verification
		const result = response?.result as any;
		expect(response?.error).toBeUndefined();
		expect(result.contents[0].uri).toBe("liop://remote/schema");
		expect(result.contents[0].text).toBe('{"foo": "bar"}');
		expect(result.contents[0].mimeType).toBe("application/json");
	});

	it("should proactively block tool execution when authRequired=true and no token is present (tokenSlug priority)", async () => {
		const mockServer = {
			getServerInfo: () => ({ name: "test", version: "1" }),
			listTools: () => [],
			listResources: () => [],
		} as unknown as LiopServer;

		const mockMeshNode = {
			registerManifestHandler: vi.fn(),
			announceManifest: vi.fn().mockResolvedValue(true),
			getPeerId: () => "local-peer",
			sign: vi.fn().mockResolvedValue(Buffer.from("intent-signature")),
		} as unknown as MeshNode;

		const router = new LiopMcpRouter(mockServer, mockMeshNode);

		// Inject mock remote peer with authRequired: true AND tokenSlug: "RESTRICTED"
		// biome-ignore lint/suspicious/noExplicitAny: testing private field
		(router as any).manifestCache = new Map([
			[
				"restricted-peer-id",
				{
					cachedAt: Date.now(),
					manifest: {
						peerId: "restricted-peer-id",
						grpcPort: 50051,
						tools: [
							{
								name: "restricted_tool",
								description: "Restricted tool",
							},
						],
						resources: [],
						serverInfo: { name: "RestrictedServer", version: "1.0.0" },
						authRequired: true,
						tokenSlug: "RESTRICTED",
					},
				},
			],
		]);

		// Clear all possible token resolution sources
		const originalToken = process.env.LIOP_TOKEN;
		const originalOauthToken = process.env.LIOP_OAUTH_TOKEN;
		delete process.env.LIOP_TOKEN;
		delete process.env.LIOP_OAUTH_TOKEN;

		const envKeysToClean = [
			"LIOP_TOKEN_RESTRICTED",
			"LIOP_TOKEN_RESTRICTEDSERVER",
		];
		const savedTokens: Record<string, string | undefined> = {};
		for (const key of envKeysToClean) {
			savedTokens[key] = process.env[key];
			delete process.env[key];
		}

		try {
			const response = await router.dispatch({
				method: "tools/call",
				params: {
					name: "restricted_tool",
					arguments: { payload: "test" },
				},
				id: 42,
			});

			expect(response).not.toBeNull();
			// biome-ignore lint/suspicious/noExplicitAny: test verification
			const result = response?.result as any;
			expect(response?.error).toBeUndefined();
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Authentication Required");
			// The error should suggest LIOP_TOKEN_RESTRICTED (from tokenSlug) as primary
			expect(result.content[0].text).toContain("LIOP_TOKEN_RESTRICTED");
		} finally {
			if (originalToken) process.env.LIOP_TOKEN = originalToken;
			if (originalOauthToken) process.env.LIOP_OAUTH_TOKEN = originalOauthToken;
			for (const key of envKeysToClean) {
				if (savedTokens[key]) process.env[key] = savedTokens[key];
			}
		}
	});

	it("should resolve token deterministically via tokenSlug and allow execution", async () => {
		const mockServer = {
			getServerInfo: () => ({ name: "test", version: "1" }),
			listTools: () => [],
			listResources: () => [],
		} as unknown as LiopServer;

		const mockMeshNode = {
			registerManifestHandler: vi.fn(),
			announceManifest: vi.fn().mockResolvedValue(true),
			getPeerId: () => "local-peer",
			sign: vi.fn().mockResolvedValue(Buffer.from("intent-signature")),
			resolvePeer: vi.fn().mockResolvedValue(["/ip4/127.0.0.1/tcp/50051"]),
		} as unknown as MeshNode;

		const router = new LiopMcpRouter(mockServer, mockMeshNode);

		// Inject mock remote peer with authRequired + tokenSlug
		// biome-ignore lint/suspicious/noExplicitAny: testing private field
		(router as any).manifestCache = new Map([
			[
				"secure-peer-id",
				{
					cachedAt: Date.now(),
					manifest: {
						peerId: "secure-peer-id",
						grpcPort: 50051,
						tools: [{ name: "secure_tool", description: "Secure tool" }],
						resources: [],
						serverInfo: { name: "SecureNode", version: "1.0.0" },
						authRequired: true,
						tokenSlug: "SECURE_NODE",
					},
				},
			],
		]);

		// Set the token that matches the slug
		process.env.LIOP_TOKEN_SECURE_NODE = "test-token-value";

		try {
			const response = await router.dispatch({
				method: "tools/call",
				params: {
					name: "secure_tool",
					arguments: { payload: "test" },
				},
				id: 99,
			});

			// If the token was resolved, execution proceeds past the auth check
			// to routeToRemoteProvider. We verify it didn't return an auth error.
			expect(response).not.toBeNull();
			// biome-ignore lint/suspicious/noExplicitAny: test verification
			const result = response?.result as any;
			// It should NOT be an auth error — it will fail at gRPC level (mock)
			// but the important thing is the auth check passed
			if (result?.isError) {
				expect(result.content[0].text).not.toContain("Authentication Required");
			}
		} finally {
			delete process.env.LIOP_TOKEN_SECURE_NODE;
		}
	});

	it("should register manifest handler that includes tokenSlug, authRequired and taxonomy", async () => {
		const mockServer = {
			getServerInfo: () => ({ name: "test", version: "1" }),
			listTools: () => [],
			listResources: () => [],
			jwtValidator: {},
			config: {
				tokenSlug: "TEST_SLUG",
				taxonomy: {
					domain: "test-domain",
					clearanceTier: 1,
					executionTypes: ["test"],
				},
			},
		} as unknown as LiopServer;

		let registeredHandler:
			| (() => import("../mesh/index.js").LiopManifest)
			| undefined;
		const mockMeshNode = {
			registerManifestHandler: (
				handler: () => import("../mesh/index.js").LiopManifest,
			) => {
				registeredHandler = handler;
			},
			announceManifest: vi.fn().mockResolvedValue(true),
			getPeerId: () => "local-peer",
		} as unknown as MeshNode;

		new LiopMcpRouter(mockServer, mockMeshNode);

		expect(registeredHandler).toBeDefined();
		if (registeredHandler) {
			const manifest = registeredHandler();
			expect(manifest.tokenSlug).toBe("TEST_SLUG");
			expect(manifest.authRequired).toBe(true);
			expect(manifest.taxonomy).toEqual({
				domain: "test-domain",
				clearanceTier: 1,
				executionTypes: ["test"],
			});
		}
	});
});
