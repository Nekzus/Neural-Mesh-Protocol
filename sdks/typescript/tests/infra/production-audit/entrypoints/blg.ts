/**
 * LIOP Border LIO Gateway (BLG) — Tier 1 / Tier 2 Perimeter Security Gateway
 *
 * Implements RFC 0001 and Sovereign Mesh Operations Manual:
 * - Multi-homed interface: sits between Tier 1 (Enclave with pnet PSK) and Tier 2 (Consortium).
 * - Asymmetric Data Boundary: Code enters via Guardian AST & Zero-Trust sandbox; raw data
 *   is strictly blocked from exiting (only differential-privacy aggregations with ZK-Receipts).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { LiopServer, LiopHybridGateway, loadSwarmKey } from "@nekzus/liop";

async function main() {
	const dataDir = process.env.LIOP_DATA_DIR || "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	// 1. Load Tier 1 Enclave Swarm Key
	let swarmKey: Uint8Array | undefined;
	const pskPath = process.env.LIOP_SWARM_KEY_PATH || path.join(dataDir, "tier1.psk");
	if (fs.existsSync(pskPath)) {
		try {
			swarmKey = await loadSwarmKey(pskPath);
			console.log(`[BLG-Prod] 🔒 Tier 1 Enclave Swarm Key loaded from: ${pskPath}`);
		} catch (err) {
			console.warn(`[BLG-Prod] Warning: could not load Swarm Key:`, err);
		}
	}

	// 2. Initialize Border Gateway Server
	const blgServer = new LiopServer(
		{
			name: "PRODUCTION-border-lio-gateway",
			version: "2.5.0",
		},
		{
			tokenSlug: "BLG",
			auth: {
				role: "node",
				nexusUrl: process.env.LIOP_NEXUS_URL || "http://nexus:3000",
			},
			taxonomy: {
				domain: "Perimeter Security & Enclave Routing (BLG TIER 1/TIER 2 BRIDGE)",
				clearanceTier: 4,
				executionTypes: ["Enclave Relay", "Boundary Inspection", "ZK Verification"],
			},
		},
	);

	// Register BLG Perimeter Status Tool
	blgServer.tool(
		"BLG_Inspect_Enclave_Perimeter",
		"Inspects the physical and cryptographic perimeter defense metrics of the Tier 1 Enclave.",
		{},
		async () => {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							gatewayRole: "Border LIO Gateway (BLG)",
							pnetStatus: swarmKey ? "ACTIVE_ENCLAVE_PSK_ISOLATION" : "UNENCRYPTED_INSECURE",
							tier1Subnet: "172.22.0.0/24",
							tier2Subnet: "172.23.0.0/24",
							defenseInDepth: [
								"Layer 1: Guardian AST",
								"Layer 2: WASI Sandbox",
								"Layer 3: Taint Analyzer (IFC)",
								"Layer 4: Egress PII Shield",
								"Layer 5: Aggregation-First Policy",
								"Layer 6: ZK-Receipt (HMAC-SHA256)",
								"Transport: pnet Swarm Key (95-byte PSK)",
							],
							boundaryPolicy: "Fail-Closed Asymmetric Compute In-situ",
						}),
					},
				],
			};
		},
	);

	// Register Proxy Ingestion Tool for Healthcare Analytics
	blgServer.tool(
		"BLG_Execute_Healthcare_Analytics",
		"Validates and forwards Logic-on-Origin compute envelopes into the Tier 1 Healthcare Test Enclave (operating on 2,500 local synthetic patient records via Analyze_Synthetic_Medical_Records for protocol security auditing).",
		{ envelope: z.string() },
		async (params: { envelope: string }) => {
			const targetVaultUrl = process.env.VAULT_INTERNAL_URL || "http://172.22.0.11:3000";
			const tokenVault = process.env.LIOP_TOKEN_VAULT || "vault-local-test-token";
			try {
				const response = await fetch(`${targetVaultUrl}/mcp`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${tokenVault}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "blg-fwd-01",
						method: "tools/call",
						params: {
							name: "Analyze_Synthetic_Medical_Records",
							arguments: { payload: params.envelope },
						},
					}),
				});

				const json = (await response.json()) as Record<string, unknown>;
				const result = json.result as {
					content?: Array<{ type: "text" | "image" | "resource"; text?: string }>;
					isError?: boolean;
				};
				return {
					content: result?.content || [
						{ type: "text" as const, text: JSON.stringify(json) },
					],
					isError: result?.isError,
				};
			} catch (err: unknown) {
				return {
					content: [
						{
							type: "text" as const,
							text: `[BLG] Error routing compute to Tier 1 Enclave: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
		{
			enforceAggregationFirst: true,
		},
	);

	// Register Proxy Ingestion Tool for Banking Analytics
	blgServer.tool(
		"BLG_Execute_Banking_Analytics",
		"Validates and forwards Logic-on-Origin compute envelopes into the Tier 1 Banking Test Enclave (operating on 1,500 local synthetic accounts via Analyze_Synthetic_Bank_Transactions for protocol security auditing).",
		{ envelope: z.string() },
		async (params: { envelope: string }) => {
			const targetBankUrl = process.env.BANK_INTERNAL_URL || "http://172.22.0.12:3000";
			const tokenBank = process.env.LIOP_TOKEN_BANK || "bank-local-test-token";
			try {
				const response = await fetch(`${targetBankUrl}/mcp`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${tokenBank}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: "blg-fwd-02",
						method: "tools/call",
						params: {
							name: "Analyze_Synthetic_Bank_Transactions",
							arguments: { payload: params.envelope },
						},
					}),
				});

				const json = (await response.json()) as Record<string, unknown>;
				const result = json.result as {
					content?: Array<{ type: "text" | "image" | "resource"; text?: string }>;
					isError?: boolean;
				};
				return {
					content: result?.content || [
						{ type: "text" as const, text: JSON.stringify(json) },
					],
					isError: result?.isError,
				};
			} catch (err: unknown) {
				return {
					content: [
						{
							type: "text" as const,
							text: `[BLG] Error routing compute to Tier 1 Enclave: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
		{
			enforceAggregationFirst: true,
		},
	);

	// 3. Connect to Mesh
	// BLG acts as the Seed node for the Tier 1 Enclave mesh with Swarm Key
	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER;

	await blgServer.connectToMesh({
		port: 50051,
		meshConfig: {
			identityPath: path.join(dataDir, "blg-identity.json"),
			listenAddresses: ["/ip4/0.0.0.0/tcp/4000"],
			bootstrapNodes: bootstrapSeed ? [bootstrapSeed] : [],
			swarmKey, // Possesses Tier 1 PSK to communicate with enclaves
		},
	});

	const meshNode = blgServer.getMeshNode();
	if (!meshNode) throw new Error("MeshNode failed to initialize on BLG");

	await meshNode.announceCapability("liop:manifest");

	const gateway = new LiopHybridGateway(blgServer, meshNode, 50051);
	const port = await gateway.listen(3000);
	console.log(`[BLG-Prod] Border LIO Gateway active on port ${port}`);

	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15008/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "blg.multiaddr"), p2pAddr);
	console.log(`[BLG-Prod] Border Gateway Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[BLG-Prod] Shutdown signal received. Closing servers...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("[BLG-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
