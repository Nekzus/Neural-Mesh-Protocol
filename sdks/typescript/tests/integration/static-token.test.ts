import * as fs from "node:fs";
import * as path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiopClient } from "../../src/client/index.js";
import { LiopServer } from "../../src/server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Static Token Coexistence and Local Revocation Integration", () => {
	const tempDir = path.resolve(__dirname, "temp-integration-test");
	const bankRevocationPath = path.join(tempDir, "bank-revocations.json");
	const vaultRevocationPath = path.join(tempDir, "vault-revocations.json");

	let bankServer: LiopServer;
	let vaultServer: LiopServer;
	let oracleServer: LiopServer;

	let bankPort: number;
	let vaultPort: number;
	let oraclePort: number;

	beforeEach(async () => {
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}

		// 1. Bank Node (Restricted, revocation list + local test token)
		bankServer = new LiopServer(
			{ name: "test-bank", version: "1.0.0" },
			{
				tokenSlug: "TEST_BANK",
				auth: {
					role: "node",
					revocationPath: bankRevocationPath,
					localTestToken: "bank-local-test-token",
				},
			},
		);
		bankServer.tool(
			"bank_tool",
			"Query bank transactions",
			{ data: (await import("zod")).z.string() },
			async (args) => {
				return {
					content: [{ type: "text", text: `Bank Success: ${args.data}` }],
					isError: false,
				};
			},
		);
		await bankServer.connectToMesh({ port: 0 });
		bankPort = bankServer.getBoundPort() || 0;

		// 2. Vault Node (Restricted, revocation list + local test token)
		vaultServer = new LiopServer(
			{ name: "test-vault", version: "1.0.0" },
			{
				tokenSlug: "TEST_VAULT",
				auth: {
					role: "node",
					revocationPath: vaultRevocationPath,
					localTestToken: "vault-local-test-token",
				},
			},
		);
		vaultServer.tool(
			"vault_tool",
			"Query medical records",
			{ data: (await import("zod")).z.string() },
			async (args) => {
				return {
					content: [{ type: "text", text: `Vault Success: ${args.data}` }],
					isError: false,
				};
			},
		);
		await vaultServer.connectToMesh({ port: 0 });
		vaultPort = vaultServer.getBoundPort() || 0;

		// 3. Oracle Node (Unrestricted, role: "none")
		oracleServer = new LiopServer(
			{ name: "test-oracle", version: "1.0.0" },
			{
				auth: {
					role: "none",
				},
			},
		);
		oracleServer.tool(
			"oracle_tool",
			"Query HFT market data",
			{ data: (await import("zod")).z.string() },
			async (args) => {
				return {
					content: [{ type: "text", text: `Oracle Success: ${args.data}` }],
					isError: false,
				};
			},
		);
		await oracleServer.connectToMesh({ port: 0 });
		oraclePort = oracleServer.getBoundPort() || 0;
	});

	afterEach(async () => {
		if (bankServer) await bankServer.close();
		if (vaultServer) await vaultServer.close();
		if (oracleServer) await oracleServer.close();

		if (fs.existsSync(bankRevocationPath)) fs.unlinkSync(bankRevocationPath);
		if (fs.existsSync(vaultRevocationPath)) fs.unlinkSync(vaultRevocationPath);
		if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
	});

	it("should allow access to Bank using bank-local-test-token (Bypass authentication)", async () => {
		const client = new LiopClient();
		await client.connect(`localhost:${bankPort}`, {
			auth: {
				token: "bank-local-test-token",
			},
		});

		const payloadArgs = { data: "test-payload" };
		const wasmPayload = Buffer.from(
			`return { "__liop_proxy_tool": "bank_tool", "__liop_proxy_args": ${JSON.stringify(payloadArgs)} };`,
			"utf-8",
		);

		const result = await client.callTool(
			{ name: "bank_tool", arguments: payloadArgs },
			wasmPayload,
		);

		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("Bank Success: test-payload");
		await client.close();
	});

	it("should reject access to Vault using bank-local-test-token (Domain Segregation Violation)", async () => {
		const client = new LiopClient();
		await client.connect(`localhost:${vaultPort}`, {
			auth: {
				token: "bank-local-test-token",
			},
		});

		const payloadArgs = { data: "test-payload" };
		const wasmPayload = Buffer.from(
			`return { "__liop_proxy_tool": "vault_tool", "__liop_proxy_args": ${JSON.stringify(payloadArgs)} };`,
			"utf-8",
		);

		await expect(
			client.callTool(
				{ name: "vault_tool", arguments: payloadArgs },
				wasmPayload,
			),
		).rejects.toThrow(/segregation violation/);

		await client.close();
	});

	it("should allow unrestricted access to Oracle node regardless of the token", async () => {
		const client = new LiopClient();
		// Connect with no token
		await client.connect(`localhost:${oraclePort}`);

		const payloadArgs = { data: "market-data" };
		const wasmPayload = Buffer.from(
			`return { "__liop_proxy_tool": "oracle_tool", "__liop_proxy_args": ${JSON.stringify(payloadArgs)} };`,
			"utf-8",
		);

		const result = await client.callTool(
			{ name: "oracle_tool", arguments: payloadArgs },
			wasmPayload,
		);

		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("Oracle Success: market-data");
		await client.close();
	});

	it("should immediately deny access after token hot-revocation and allow back after restoration", async () => {
		const client = new LiopClient();
		await client.connect(`localhost:${bankPort}`, {
			auth: {
				token: "bank-local-test-token",
			},
		});

		const payloadArgs = { data: "authorized-run" };
		const wasmPayload = Buffer.from(
			`return { "__liop_proxy_tool": "bank_tool", "__liop_proxy_args": ${JSON.stringify(payloadArgs)} };`,
			"utf-8",
		);

		// First call succeeds
		const result1 = await client.callTool(
			{ name: "bank_tool", arguments: payloadArgs },
			wasmPayload,
		);
		expect(result1.isError).toBe(false);

		// Revoke the token using direct API (which triggers hot reload via mtime simulation/write)
		bankServer.revokeToken("bank-local-test-token");

		// Second call must fail
		await expect(
			client.callTool(
				{ name: "bank_tool", arguments: payloadArgs },
				wasmPayload,
			),
		).rejects.toThrow(/revoked/);

		// Restore the access by cleaning the file
		fs.writeFileSync(bankRevocationPath, JSON.stringify([], null, 2), "utf-8");
		// Update mtime to force reload
		const futureTime = Date.now() / 1000 + 10;
		fs.utimesSync(bankRevocationPath, futureTime, futureTime);

		// Third call succeeds again
		const result3 = await client.callTool(
			{ name: "bank_tool", arguments: payloadArgs },
			wasmPayload,
		);
		expect(result3.isError).toBe(false);
		expect(result3.content[0].text).toContain("Bank Success: authorized-run");

		await client.close();
	});

	it("should dynamically resolve node-specific tokens from environment variables (Multi-Node Isolation Bypass)", async () => {
		// Set node-specific environment tokens
		process.env.LIOP_TOKEN_TEST_BANK = "bank-local-test-token";
		process.env.LIOP_TOKEN_TEST_VAULT = "vault-local-test-token";

		// Unset any global token to make sure resolution uses the specific ones
		const originalGlobalToken = process.env.LIOP_TOKEN;
		delete process.env.LIOP_TOKEN;

		try {
			const client = new LiopClient();
			// Connect without explicit token option to force environment resolution
			await client.connect();

			// Mock resolveCapability to avoid slow and flaky Kademlia DHT discovery in tests
			client.resolveCapability = async (toolName: string) => {
				if (toolName === "bank_tool") return `localhost:${bankPort}`;
				if (toolName === "vault_tool") return `localhost:${vaultPort}`;
				throw new Error(`Mock resolver: unknown tool ${toolName}`);
			};

			// 1. Resolve Bank Node target and call its tool
			const bankTarget = `localhost:${bankPort}`;
			const bankPeerId = bankServer.getMeshNode()!.getPeerId();
			// Inject to mock manifest cache in client
			const bankManifest = (bankServer.getMeshNode() as any).manifestProvider();
			client["manifests"].set(bankPeerId, bankManifest);

			const bankClient = (client as any).getOrCreateRpcClient(bankPeerId, bankTarget);
			const resolvedToken = typeof bankClient.token === "function" ? await bankClient.token() : bankClient.token;
			expect(resolvedToken).toBe("bank-local-test-token");

			const bankArgs = { data: "env-bank-test" };
			const bankWasm = Buffer.from(
				`return { "__liop_proxy_tool": "bank_tool", "__liop_proxy_args": ${JSON.stringify(bankArgs)} };`,
				"utf-8",
			);
			const bankResult = await client.callTool(
				{ name: "bank_tool", arguments: bankArgs },
				bankWasm,
			);
			expect(bankResult.isError).toBe(false);
			expect(bankResult.content[0].text).toContain("Bank Success: env-bank-test");

			// 2. Resolve Vault Node target and call its tool
			const vaultTarget = `localhost:${vaultPort}`;
			const vaultPeerId = vaultServer.getMeshNode()!.getPeerId();
			// Inject to mock manifest cache in client
			const vaultManifest = (vaultServer.getMeshNode() as any).manifestProvider();
			client["manifests"].set(vaultPeerId, vaultManifest);

			const vaultClient = (client as any).getOrCreateRpcClient(vaultPeerId, vaultTarget);
			const resolvedVaultToken = typeof vaultClient.token === "function" ? await vaultClient.token() : vaultClient.token;
			expect(resolvedVaultToken).toBe("vault-local-test-token");

			const vaultArgs = { data: "env-vault-test" };
			const vaultWasm = Buffer.from(
				`return { "__liop_proxy_tool": "vault_tool", "__liop_proxy_args": ${JSON.stringify(vaultArgs)} };`,
				"utf-8",
			);
			const vaultResult = await client.callTool(
				{ name: "vault_tool", arguments: vaultArgs },
				vaultWasm,
			);
			expect(vaultResult.isError).toBe(false);
			expect(vaultResult.content[0].text).toContain("Vault Success: env-vault-test");

			await client.close();
		} finally {
			// Clean up environment variables
			delete process.env.LIOP_TOKEN_TEST_BANK;
			delete process.env.LIOP_TOKEN_TEST_VAULT;
			if (originalGlobalToken) {
				process.env.LIOP_TOKEN = originalGlobalToken;
			}
		}
	});
});
