import { describe, expect, it } from "vitest";
import { authorizeRequest, LIOP_SCOPES, type AuthorizationResult } from "../../../src/security/rbac.js";
import type { AuthInfo } from "../../../src/security/jwt-validator.js";

function makeAuth(scopes: string[]): AuthInfo {
	return {
		token: "test-token",
		clientId: "test-client",
		scopes,
		expiresAt: Math.floor(Date.now() / 1000) + 3600,
	};
}

describe("RBAC authorizeRequest", () => {
	describe("Public methods (no auth required)", () => {
		const publicMethods = [
			"initialize",
			"notifications/initialized",
			"notifications/cancelled",
			"ping",
			"server/discover",
			"subscriptions/listen",
		];

		for (const method of publicMethods) {
			it(`should allow '${method}' without authentication`, () => {
				const result = authorizeRequest(method, null);
				expect(result.allowed).toBe(true);
			});

			it(`should allow '${method}' with authentication`, () => {
				const result = authorizeRequest(method, makeAuth(["liop:tools:call"]));
				expect(result.allowed).toBe(true);
			});
		}
	});

	describe("Protected methods (auth required)", () => {
		const protectedCases: Array<{ method: string; scope: string }> = [
			{ method: "tools/list", scope: "liop:tools:list" },
			{ method: "tools/call", scope: "liop:tools:call" },
			{ method: "resources/list", scope: "liop:resources:read" },
			{ method: "resources/read", scope: "liop:resources:read" },
			{ method: "resources/templates/list", scope: "liop:resources:read" },
			{ method: "prompts/list", scope: "liop:schema:read" },
			{ method: "prompts/get", scope: "liop:schema:read" },
		];

		for (const { method, scope } of protectedCases) {
			it(`should deny '${method}' without authentication`, () => {
				const result = authorizeRequest(method, null);
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain("Authentication required");
			});

			it(`should deny '${method}' with wrong scopes`, () => {
				const result = authorizeRequest(method, makeAuth(["liop:wrong:scope"]));
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain("Insufficient scopes");
				expect(result.reason).toContain(scope);
			});

			it(`should allow '${method}' with correct scope`, () => {
				const result = authorizeRequest(method, makeAuth([scope]));
				expect(result.allowed).toBe(true);
			});
		}
	});

	describe("Unknown methods (fail-closed)", () => {
		it("should deny unknown methods without auth", () => {
			const result = authorizeRequest("custom/method", null);
			expect(result.allowed).toBe(false);
		});

		it("should deny unknown methods with auth (fail-closed)", () => {
			const result = authorizeRequest(
				"custom/unknown",
				makeAuth(["liop:tools:call"]),
			);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Unknown method");
		});
	});

	describe("Additional scopes", () => {
		it("should require additional scopes when specified", () => {
			const result = authorizeRequest(
				"tools/call",
				makeAuth(["liop:tools:call"]),
				["liop:mesh:query"],
			);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("liop:mesh:query");
		});

		it("should allow when client has both method and additional scopes", () => {
			const result = authorizeRequest(
				"tools/call",
				makeAuth(["liop:tools:call", "liop:mesh:query"]),
				["liop:mesh:query"],
			);
			expect(result.allowed).toBe(true);
		});
	});

	describe("LIOP_SCOPES constant", () => {
		it("should export all defined protocol scopes", () => {
			expect(LIOP_SCOPES).toContain("liop:tools:list");
			expect(LIOP_SCOPES).toContain("liop:tools:call");
			expect(LIOP_SCOPES).toContain("liop:resources:read");
			expect(LIOP_SCOPES).toContain("liop:schema:read");
			expect(LIOP_SCOPES).toContain("liop:mesh:query");
			expect(LIOP_SCOPES.length).toBe(5);
		});
	});
});
