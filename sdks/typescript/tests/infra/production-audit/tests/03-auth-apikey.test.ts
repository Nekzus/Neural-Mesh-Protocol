import { describe, expect, it } from "vitest";
import { mcpCall } from "./_helpers.js";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 03 — OAuth 2.1 M2M, API Keys & Dual-Era Protocol Auth", () => {
	it("should acquire an OAuth 2.1 JWT access token via client_credentials grant", async () => {
		const res = await fetch(`${NEXUS_URL}/oidc/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: process.env.LIOP_CLIENT_ID || "liop-mesh-agent",
				client_secret: process.env.LIOP_CLIENT_SECRET || "dev-secret-change-me",
				resource: "urn:liop:mesh:api",
				scope: "liop:tools:call liop:tools:list liop:resources:read liop:schema:read liop:mesh:query",
			}).toString(),
		});

		expect(res.ok).toBe(true);
		const data = (await res.json()) as { access_token: string; token_type: string; expires_in: number };
		expect(data.access_token).toBeDefined();
		expect(data.access_token.split(".").length).toBe(3); // Valid JWT structure
		expect(data.token_type).toBe("Bearer");
		expect(data.expires_in).toBeGreaterThan(0);
	});

	it("should reject unauthenticated MCP request when OAuth is enforced", async () => {
		const res = await fetch(`${NEXUS_URL}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer invalid-expired-malicious-token",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 999,
				method: "tools/list",
				params: {},
			}),
		});

		// Should reject with 401 or JsonRpc error
		if (res.status === 401) {
			expect(res.status).toBe(401);
		} else {
			const body = (await res.json()) as { error?: { code: number } };
			expect(body.error).toBeDefined();
		}
	});

	it("should handle MCP 2026-07-28 modern protocol initialization handshake", async () => {
		const res = await mcpCall("initialize", {
			protocolVersion: "2026-07-28",
			capabilities: { tools: {} },
			clientInfo: { name: "AuditProductionAgent", version: "2.5.0" },
		});

		expect(res.error).toBeUndefined();
		expect(res.result).toBeDefined();
		expect(res.result.serverInfo).toBeDefined();
		expect(res.result.capabilities).toBeDefined();
	});

	it("should handle MCP 2025-11-25 legacy handshake with backward-compatible response", async () => {
		const res = await mcpCall("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "LegacyTestClient", version: "1.0.0" },
		});

		expect(res.error).toBeUndefined();
		expect(res.result).toBeDefined();
		expect(res.result.protocolVersion).toBeDefined();
	});
});
