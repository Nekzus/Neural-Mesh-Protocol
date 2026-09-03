/**
 * TopologyProbe Test Suite — RFC 9728 Discovery & Mode Detection
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeTopology } from "./topology-probe.js";

describe("TopologyProbe", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("should detect Gateway mode when candidate URL responds healthy", async () => {
		global.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url === "http://127.0.0.1:15018/health") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						status: "healthy",
						tools: ["BLG_Tool1", "BLG_Tool2"],
						auth: {
							issuer: "http://127.0.0.1:15000/oidc",
							token_endpoint: "http://127.0.0.1:15000/oidc/token",
						},
						topology: { tier: 2 },
					}),
				} as Response;
			}
			if (
				url === "http://127.0.0.1:15018/.well-known/oauth-protected-resource"
			) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						resource: "urn:liop:mesh:api",
						authorization_servers: ["http://127.0.0.1:15000/oidc"],
						scopes_supported: ["liop:tools:call", "liop:tools:list"],
					}),
				} as Response;
			}
			return { ok: false, status: 404 } as Response;
		});

		const result = await probeTopology({
			blgUrl: "http://127.0.0.1:15018",
			autoProbeLocal: false,
		});

		expect(result.mode).toBe("gateway");
		expect(result.gateway).toBeDefined();
		expect(result.gateway?.baseUrl).toBe("http://127.0.0.1:15018");
		expect(result.gateway?.tokenEndpoint).toBe(
			"http://127.0.0.1:15000/oidc/token",
		);
		expect(result.gateway?.tools).toEqual(["BLG_Tool1", "BLG_Tool2"]);
		expect(result.gateway?.tier).toBe(2);
	});

	it("should detect Hybrid mode when both Gateway and P2P bootstraps exist", async () => {
		global.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (url === "http://127.0.0.1:15018/health") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						status: "healthy",
						tools: ["BLG_Tool1"],
						auth: { issuer: "http://127.0.0.1:15000/oidc" },
					}),
				} as Response;
			}
			return { ok: false, status: 404 } as Response;
		});

		const result = await probeTopology({
			blgUrl: "http://127.0.0.1:15018",
			bootstrapNodes: ["/ip4/127.0.0.1/tcp/15001/p2p/12D3KooW..."],
			autoProbeLocal: false,
		});

		expect(result.mode).toBe("hybrid");
		expect(result.gateway).toBeDefined();
		expect(result.mesh).toBeDefined();
		expect(result.mesh?.bootstrapNodes.length).toBe(1);
	});

	it("should fallback to Mesh mode when Gateway is unreachable", async () => {
		global.fetch = vi.fn().mockImplementation(async () => {
			throw new Error("Connection refused");
		});

		const result = await probeTopology({
			blgUrl: "http://127.0.0.1:15018",
			bootstrapNodes: ["/ip4/127.0.0.1/tcp/13001/p2p/12D3KooW..."],
			autoProbeLocal: false,
		});

		expect(result.mode).toBe("mesh");
		expect(result.gateway).toBeUndefined();
		expect(result.mesh?.bootstrapNodes.length).toBe(1);
	});
});
