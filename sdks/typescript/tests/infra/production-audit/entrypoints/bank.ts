/**
 * LIOP Bank Node — Financial Data Provider (Production Package Audit)
 *
 * Runs the published @nekzus/liop package in a realistic WAN environment.
 * Evaluates Differential Privacy (SOX/PCI-DSS), ZK-Receipts, and Aggregation-First
 * with scaled realistic datasets (500 scale = 1,500 accounts).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";
import { generateBankDataset } from "../utils/datasetGenerator.js";

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const liopServer = new LiopServer(
		{
			name: "PRODUCTION-the-bank",
			version: "2.5.0",
		},
		{
			tokenSlug: "BANK",
			taxonomy: {
				domain: "Banking & Finance (REALISTIC PRODUCTION AUDIT)",
				clearanceTier: 3,
				executionTypes: ["Read-Only Queries", "Transactional Verification"],
			},
			budgetStorePath: path.join(dataDir, "bank-query-budgets.json"),
		},
	);

	// Scaled Financial Dataset (Default scale: 500 = 1,500 accounts)
	const scaleEnv = process.env.LIOP_DATASET_SCALE;
	const scale = scaleEnv ? Number.parseInt(scaleEnv, 10) : 500;
	const accounts = generateBankDataset(Number.isNaN(scale) ? 500 : scale);
	console.log(`[Bank-Prod] Loaded ${accounts.length} synthetic accounts (scale=${scale})`);

	liopServer.dataDictionary(
		{
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", description: "Account Unique ID (ACC-XXXX)" },
					uuid: { type: "string", format: "uuid", description: "Cryptographic UUIDv4" },
					accountHolder: { type: "string" },
					accountType: { type: "string" },
					balance: { type: "number" },
					currency: { type: "string" },
					status: { type: "string", enum: ["CLEARED", "PENDING", "FLAGGED"] },
					openedAt: { type: "string", format: "date-time" },
					geoCoordinates: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
					riskScore: { type: "number", minimum: 0, maximum: 1 },
					accountTier: { type: "string", enum: ["RETAIL", "PREMIUM", "WEALTH"] },
					isKycVerified: { type: "boolean" },
					transactions: {
						type: "array",
						items: {
							type: "object",
							properties: {
								txId: { type: "string" },
								timestamp: { type: "string", format: "date-time" },
								date: { type: "string", format: "date" },
								amount: { type: "number" },
								description: { type: "string" },
								category: { type: "string" },
								fee: { type: "number" },
								isInternational: { type: "boolean" },
							},
						},
					},
				},
			},
		},
		"Banking Ledger Schema (PRODUCTION AUDIT)",
		"LIOP://schema/banking-ledger-synthetic",
	);

	liopServer.setSandboxData(accounts as unknown as Record<string, unknown>[]);

	const bankAggregatedOutputSchema = z
		.object({
			totalAccounts: z.number().optional(),
			total_records: z.number().optional(),
			byType: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			distribution: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			totalBalance: z.union([z.number(), z.string()]).optional(),
			avgBalance: z.union([z.number(), z.string()]).optional(),
			averageBalance: z.union([z.number(), z.string()]).optional(),
			balanceByCurrency: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			columns: z.array(z.string()).optional(),
			clientPayload: z.string().optional(),
		})
		.catchall(z.union([z.number(), z.string(), z.boolean()]));

	liopServer.tool(
		"Analyze_Synthetic_Bank_Transactions",
		"Production Audit: Securely analyzes financial transactions and account balances via LIOP Logic-on-Origin under WAN network shaping.",
		{ payload: z.string() },
		async (_params) => {
			return {
				content: [
					{
						type: "text",
						text: "[LIOP] Security Enforcement: Legacy Plain-Tool execution is BLOCKED. Banking data requires secure Logic-on-Origin processing. Wrap your JS logic in the LIOPv1 Envelope to continue.",
					},
				],
				isError: true,
			};
		},
		{
			enforceAggregationFirst: true,
			outputSchema: bankAggregatedOutputSchema,
			dpEpsilon: 2.0,
			dpSensitivity: 100000.0,
			sensitiveKeys: ["accountType"],
			queryBudgetPerField: process.env.LIOP_QUERY_BUDGET
				? Number.parseInt(process.env.LIOP_QUERY_BUDGET, 10)
				: 1000,
		},
	);

	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER || "/ip4/172.21.0.10/tcp/4000";

	let swarmKey: Uint8Array | undefined;
	const pskPath = process.env.LIOP_SWARM_KEY_PATH || path.join(dataDir, "tier1.psk");
	if (fs.existsSync(pskPath)) {
		try {
			const { loadSwarmKey } = await import("@nekzus/liop");
			swarmKey = await loadSwarmKey(pskPath);
			console.log(`[Bank-Prod] 🔒 Tier 1 Enclave Swarm Key loaded from: ${pskPath}`);
		} catch (err) {
			console.warn(`[Bank-Prod] Failed to load Swarm Key from ${pskPath}:`, err);
		}
	}

	await liopServer.connectToMesh({
		port: 50051,
		meshConfig: {
			identityPath: path.join(dataDir, "bank-identity.json"),
			listenAddresses: ["/ip4/0.0.0.0/tcp/4000"],
			bootstrapNodes: [bootstrapSeed],
			swarmKey,
		},
	});

	const meshNode = liopServer.getMeshNode();
	if (!meshNode) throw new Error("Failed to initialize MeshNode");

	await meshNode.announceCapability("liop:manifest");

	const gateway = new LiopHybridGateway(liopServer, meshNode, 50051);
	const port = await gateway.listen(3000);
	console.log(`[Bank-Prod] Gateway active on port ${port}`);

	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15004/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "bank.multiaddr"), p2pAddr);
	console.log(`[Bank-Prod] Industrial Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[Bank-Prod] Shutdown signal received. Closing servers...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// Periodic manifest refresh
	setInterval(async () => {
		try {
			await gateway.getRouter().refreshManifestCache(true);
		} catch (_e) {
			/* ignore */
		}
	}, 15000);
}

main().catch((err) => {
	console.error("[Bank-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
