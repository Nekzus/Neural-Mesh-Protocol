import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Production Audit Suite 00 — NPM Package Integrity & Sub-exports (@nekzus/liop@latest)", () => {
	it("should resolve primary entrypoint from @nekzus/liop cleanly", async () => {
		const pkg = await import("@nekzus/liop");
		expect(pkg).toBeDefined();
		expect(typeof pkg.LiopServer).toBe("function");
		expect(typeof pkg.LiopClient).toBe("function");
		expect(typeof pkg.LiopHybridGateway).toBe("function");
		expect(typeof pkg.MeshNode).toBe("function");
	});

	it("should resolve sub-export @nekzus/liop/server", async () => {
		const serverModule = await import("@nekzus/liop/server");
		expect(serverModule).toBeDefined();
		expect(typeof serverModule.LiopServer).toBe("function");
	});

	it("should resolve sub-export @nekzus/liop/client", async () => {
		const clientModule = await import("@nekzus/liop/client");
		expect(clientModule).toBeDefined();
		expect(typeof clientModule.LiopClient).toBe("function");
	});

	it("should resolve sub-export @nekzus/liop/mesh", async () => {
		const meshModule = await import("@nekzus/liop/mesh");
		expect(meshModule).toBeDefined();
		expect(typeof meshModule.MeshNode).toBe("function");
	});

	it("should resolve sub-export @nekzus/liop/gateway", async () => {
		const gatewayModule = await import("@nekzus/liop/gateway");
		expect(gatewayModule).toBeDefined();
		expect(typeof gatewayModule.LiopHybridGateway).toBe("function");
	});

	it("should resolve sub-export @nekzus/liop/bridge", async () => {
		const bridgeModule = await import("@nekzus/liop/bridge");
		expect(bridgeModule).toBeDefined();
	});

	it("should export Post-Quantum ML-DSA-65 and ML-KEM-768 primitives", async () => {
		const pkg = await import("@nekzus/liop");
		expect(pkg.Dilithium65Wrapper).toBeDefined();
		expect(typeof pkg.Dilithium65Wrapper.signManifest).toBe("function");
		expect(typeof pkg.Dilithium65Wrapper.verifyManifest).toBe("function");
	});

	it("should export OAuth 2.1 M2M and RBAC security functions", async () => {
		const pkg = await import("@nekzus/liop");
		expect(typeof pkg.createOAuthServer).toBe("function");
		expect(typeof pkg.authorizeRequest).toBe("function");
		expect(pkg.LIOP_SCOPES).toBeDefined();
	});

	it("should verify installed node_modules footprint is under 120MB threshold", () => {
		const checkDir = (dirPath: string): number => {
			let total = 0;
			try {
				const files = fs.readdirSync(dirPath);
				for (const file of files) {
					const full = path.join(dirPath, file);
					const stat = fs.statSync(full);
					if (stat.isDirectory()) {
						total += checkDir(full);
					} else {
						total += stat.size;
					}
				}
			} catch {
				/* ignore unreadable */
			}
			return total;
		};

		// Check if we are inside container or host
		const candidatePaths = [
			path.resolve("/app/node_modules/@nekzus/liop"),
			path.resolve(process.cwd(), "node_modules/@nekzus/liop"),
			path.resolve(process.cwd(), "../../node_modules/@nekzus/liop"),
		];

		const foundPath = candidatePaths.find((p) => fs.existsSync(p));
		if (foundPath) {
			const sizeBytes = checkDir(foundPath);
			const sizeMb = sizeBytes / (1024 * 1024);
			console.log(`[@nekzus/liop Package Size] ${sizeMb.toFixed(2)} MB at ${foundPath}`);
			expect(sizeMb).toBeLessThan(120);
		} else {
			console.warn("[Package Size Audit] @nekzus/liop folder not found in candidates, skipping size check");
		}
	});
});
