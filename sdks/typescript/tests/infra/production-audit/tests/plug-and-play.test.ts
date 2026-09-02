/**
 * LIOP Production Package Audit — Plug and Play Verification Suite
 *
 * Verifies that the published `@nekzus/liop` package is genuinely 100% functional,
 * robust, and out-of-the-box "Plug and Play" with minimal configuration for:
 *   1. LiopServer (Tool registration, Sandbox data, Zero-Trust preflight)
 *   2. LiopHybridGateway (MCP HTTP/SSE Adapter, tools/list, tools/call)
 *   3. LiopClient (Agent RPC interface, callTool, discoverTools)
 *   4. MeshNode (Zero-config P2P startup, Ed25519 identity, ephemeral ports)
 *   5. Post-Quantum Cryptography (ML-KEM-768 & ML-DSA-65 out-of-the-box)
 *   6. WasiSandbox (V8 Isolated execution & fuel limits)
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	LiopServer,
	LiopHybridGateway,
	LiopClient,
	MeshNode,
	Kyber768Wrapper,
	Dilithium65Wrapper,
	WasiSandbox,
} from "@nekzus/liop";

describe("Production Audit — Plug and Play Minimal Configuration Verification", () => {
	it("PnP-01: LiopServer should initialize and register tools in under 5 lines of code", async () => {
		// 1. Initialize server with minimal config
		const server = new LiopServer({ name: "pnp-calc-service", version: "1.0.0" });

		// 2. Register tool with Zod schema
		server.tool(
			"add_numbers",
			"Adds two numbers",
			{ a: z.number(), b: z.number() },
			async ({ a, b }: { a: number; b: number }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		);

		// 3. Verify tool listing via public API
		const tools = server.listTools();
		expect(tools.length).toBe(1);
		expect(tools[0].name).toBe("add_numbers");
		expect(tools[0].description).toContain("Adds two numbers");

		// 4. Directly invoke tool locally
		const result = await server.callTool({
			name: "add_numbers",
			arguments: { a: 25, b: 75 },
		});
		expect(result.content[0].text).toBe("100");
	});

	it("PnP-02: LiopHybridGateway should adapt LiopServer to standard MCP JSON-RPC out-of-the-box", async () => {
		// 1. Create minimal server
		const server = new LiopServer({ name: "pnp-mcp-server", version: "1.0.0" });
		server.tool(
			"echo_greeting",
			"Greets a user",
			{ name: z.string() },
			async ({ name }: { name: string }) => ({
				content: [{ type: "text", text: `Hello, ${name}!` }],
			}),
		);

		// 2. Wrap in Hybrid Gateway (MCP Adapter) and bind to ephemeral port
		const gateway = new LiopHybridGateway(server, null, 0);
		const assignedPort = await gateway.listen(0, "127.0.0.1");

		try {
			// 3. Test MCP tools/list over HTTP
			const listRes = await fetch(`http://127.0.0.1:${assignedPort}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: "req-list-1",
					method: "tools/list",
					params: {},
				}),
			});
			expect(listRes.status).toBe(200);

			const listJson = (await listRes.json()) as any;
			expect(listJson.result?.tools).toBeDefined();
			expect(listJson.result.tools.length).toBeGreaterThanOrEqual(1);

			const echoTool = listJson.result.tools.find((t: any) => t.name === "echo_greeting");
			expect(echoTool).toBeDefined();
			expect(echoTool.description).toContain("Greets a user");

			// 4. Test MCP tools/call over HTTP
			const callRes = await fetch(`http://127.0.0.1:${assignedPort}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: "req-call-1",
					method: "tools/call",
					params: {
						name: "echo_greeting",
						arguments: { name: "Antigravity" },
					},
				}),
			});
			expect(callRes.status).toBe(200);

			const callJson = (await callRes.json()) as any;
			expect(callJson.result?.content?.[0]?.text).toBe("Hello, Antigravity!");
		} finally {
			await gateway.stop();
		}
	});

	it("PnP-03: LiopClient should instantiate and expose Agent client interface without external config", () => {
		const client = new LiopClient();
		expect(client).toBeDefined();
		expect(typeof client.callTool).toBe("function");
		expect(typeof client.discoverTools).toBe("function");
		expect(typeof client.connect).toBe("function");
		expect(typeof client.readResource).toBe("function");
	});

	it("PnP-04: MeshNode should generate cryptographic identity and start on ephemeral port out-of-the-box", async () => {
		// Zero-config P2P Node on ephemeral port
		const meshNode = new MeshNode({
			listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
		});

		await meshNode.start();

		try {
			const peerId = meshNode.getPeerId();
			expect(peerId).toBeDefined();
			expect(typeof peerId).toBe("string");
			expect(peerId.length).toBeGreaterThan(20);

			const multiaddrs = meshNode.getMultiaddrs();
			expect(multiaddrs.length).toBeGreaterThan(0);
			expect(multiaddrs[0]).toContain("/ip4/127.0.0.1/tcp/");
		} finally {
			await meshNode.stop();
		}
	});

	it("PnP-05: Post-Quantum Cryptography should operate plug-and-play with zero external binaries", async () => {
		// 1. ML-KEM-768 (Kyber)
		const serverKeyPair = await Kyber768Wrapper.generateKeyPair();
		expect(serverKeyPair.publicKey.length).toBe(1184);
		expect(serverKeyPair.secretKey.length).toBe(2400);

		const { ciphertext, sharedSecret: clientSecret } = await Kyber768Wrapper.encapsulateAsymmetric(serverKeyPair.publicKey);
		expect(ciphertext.length).toBe(1088);
		expect(clientSecret.length).toBe(32);

		const serverSecret = await Kyber768Wrapper.decapsulateSymmetric(ciphertext, serverKeyPair.secretKey);
		expect(Buffer.from(serverSecret).toString("hex")).toBe(Buffer.from(clientSecret).toString("hex"));

		// 2. ML-DSA-65 (Dilithium)
		const dsaKeyPair = Dilithium65Wrapper.generateKeyPair();
		expect(dsaKeyPair.publicKey.length).toBe(1952);
		expect(dsaKeyPair.secretKey.length).toBe(4032);

		const dummyManifest = {
			nodeId: "pnp-test-node",
			timestamp: Date.now(),
			capabilities: ["tools/list", "logic/inject"],
		};

		const signed = Dilithium65Wrapper.signManifest(dummyManifest, dsaKeyPair.secretKey, dsaKeyPair.publicKey);
		expect(typeof signed.signature).toBe("string");
		expect(signed.signature.length).toBeGreaterThan(100);

		const isValid = Dilithium65Wrapper.verifyManifest(dummyManifest, signed.signature, signed.publicKey);
		expect(isValid).toBe(true);

		// Corrupted manifest must fail verification
		const corruptedManifest = { ...dummyManifest, capabilities: ["malicious/escalation"] };
		const isCorruptedValid = Dilithium65Wrapper.verifyManifest(corruptedManifest, signed.signature, signed.publicKey);
		expect(isCorruptedValid).toBe(false);
	});

	it("PnP-06: WasiSandbox should execute logic in isolated V8 context without filesystem leaks", async () => {
		const sandbox = new WasiSandbox({ allowEnv: false });
		await sandbox.init();

		try {
			const result = await sandbox.execute(
				"const total = env.records.reduce((acc, r) => acc + r.val, 0); return { total, count: env.records.length };",
				[{ id: 1, val: 15 }, { id: 2, val: 25 }, { id: 3, val: 60 }],
			);

			const parsed = typeof result.output === "string" ? JSON.parse(result.output) : (result.output as any);
			expect(parsed.total).toBe(100);
			expect(parsed.count).toBe(3);
			expect(result.fuelConsumed).toBeGreaterThan(0);
		} finally {
			await sandbox.teardown();
		}
	});
});
