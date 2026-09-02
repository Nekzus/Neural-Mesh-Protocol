/**
 * LIOP HFT Oracle Node — Real-time Market Simulator (Production Package Audit)
 *
 * Runs the published @nekzus/liop package in a realistic WAN environment.
 * Evaluates real-time HFT data streaming under Cross-Pacific latency (150ms).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";
import { TickEngine, generateHftSnapshot, generateStaticHftDataset } from "../hft/index.js";

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const server = new LiopServer(
		{
			name: "PRODUCTION-the-oracle",
			version: "2.5.0",
			capabilities: { tools: {} },
		},
		{
			tokenSlug: "ORACLE",
			auth: {
				role: "none",
			},
			taxonomy: {
				domain: "HFT Market Data (REALISTIC PRODUCTION AUDIT)",
				clearanceTier: 1,
				executionTypes: ["Open Endpoints"],
			},
			budgetStorePath: path.join(dataDir, "oracle-query-budgets.json"),
		},
	);

	const tickIntervalMs = process.env.LIOP_HFT_TICK_INTERVAL_MS
		? Number.parseInt(process.env.LIOP_HFT_TICK_INTERVAL_MS, 10)
		: 50;
	const instrumentCount = process.env.LIOP_HFT_INSTRUMENTS
		? Number.parseInt(process.env.LIOP_HFT_INSTRUMENTS, 10)
		: 8;

	const tickEngine = new TickEngine({
		tickIntervalMs: Number.isNaN(tickIntervalMs) ? 50 : tickIntervalMs,
		instrumentCount: Number.isNaN(instrumentCount) ? 8 : instrumentCount,
		auditBufferSize: 50000,
		burnInTicks: 40,
		snapshotRefreshInterval: 5,
	});

	const initialData = generateStaticHftDataset();
	server.setSandboxData(initialData as unknown as Record<string, unknown>[]);

	server.dataDictionary(
		{
			type: "array",
			items: {
				type: "object",
				properties: {
					ticker: { type: "string", description: "Instrument symbol (e.g. AAPL)" },
					price: { type: "number", description: "Last traded price (USD)" },
					change: { type: "string", description: "% change from session open" },
					volume: { type: "string", description: "Cumulative volume (formatted)" },
					peRatio: { type: "number", nullable: true, description: "Price-to-Earnings ratio" },
					marketCap: { type: "string", description: "Market capitalization" },
					bestBid: { type: "number", description: "Best bid price (L2)" },
					bestAsk: { type: "number", description: "Best ask price (L2)" },
					spread: { type: "number", description: "Bid-ask spread (USD)" },
					spreadBps: { type: "number", description: "Spread in basis points" },
					bidDepth: { type: "number", description: "Total bid depth (top 5 levels)" },
					askDepth: { type: "number", description: "Total ask depth (top 5 levels)" },
					imbalance: { type: "number", description: "Order book imbalance [-1, 1]" },
					lastTradePrice: { type: "number", description: "Price of the last trade" },
					lastTradeQty: { type: "number", description: "Quantity of the last trade" },
					ticksPerSecond: { type: "number", description: "Engine throughput (ticks/s)" },
					volatility30s: { type: "number", description: "Rolling 30s log-return volatility" },
					vwap: { type: "number", description: "Session VWAP" },
				},
			},
		},
		"HFT Market Data Schema (PRODUCTION AUDIT)",
		"LIOP://schema/hft-market-data-synthetic",
	);

	const hftAggregatedOutputSchema = z
		.object({
			total: z.number().optional(),
			total_records: z.number().optional(),
			avgPrice: z.union([z.number(), z.string()]).optional(),
			avgSpread: z.union([z.number(), z.string()]).optional(),
			avgVolatility: z.union([z.number(), z.string()]).optional(),
			avgImbalance: z.union([z.number(), z.string()]).optional(),
			positives: z.number().optional(),
			negatives: z.number().optional(),
			maxPrice: z.number().optional(),
			minPrice: z.number().optional(),
			maxSpread: z.number().optional(),
			minSpread: z.number().optional(),
			totalVolume: z.union([z.number(), z.string()]).optional(),
			avgVwap: z.union([z.number(), z.string()]).optional(),
			columns: z.array(z.string()).optional(),
			clientPayload: z.string().optional(),
		})
		.catchall(z.union([z.number(), z.string(), z.boolean()]));

	server.tool(
		"Analyze_HFT_Market_Data",
		"Production Audit: Securely analyzes real-time HFT market ticks (Heston + Jump Diffusion model, 8 instruments, L2 order book) via LIOP Logic-on-Origin under WAN conditions.",
		{ payload: z.string() },
		async (_params) => {
			return {
				content: [
					{
						type: "text",
						text: "[LIOP] Security Enforcement: Legacy Plain-Tool execution is BLOCKED. HFT market data analysis requires secure Logic-on-Origin (LIOPv1 Envelope).",
					},
				],
				isError: true,
			};
		},
		{
			enforceAggregationFirst: true,
			outputSchema: hftAggregatedOutputSchema,
			dpEpsilon: 4.0,
			dpSensitivity: 5.0,
			sensitiveKeys: ["ticker", "companyName"],
		},
	);

	console.log(`[Oracle-Prod] Starting HFT engine: ${instrumentCount} instruments @ ${tickIntervalMs}ms`);
	await tickEngine.start();
	console.log("[Oracle-Prod] HFT engine active — burn-in complete");

	const hftData = generateHftSnapshot(tickEngine);
	if (hftData.length > 0) {
		server.setSandboxData(hftData as unknown as Record<string, unknown>[]);
	}

	const dataRefreshInterval = setInterval(() => {
		const snapshot = generateHftSnapshot(tickEngine);
		if (snapshot.length > 0) {
			server.setSandboxData(snapshot as unknown as Record<string, unknown>[]);
		}
	}, 1000);

	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER || "/ip4/172.21.0.10/tcp/4000";

	await server.connectToMesh({
		port: 50051,
		meshConfig: {
			listenAddresses: ["/ip4/0.0.0.0/tcp/4000"],
			identityPath: path.join(dataDir, "oracle-identity.json"),
			bootstrapNodes: [bootstrapSeed],
		},
	});

	const meshNode = server.getMeshNode();
	if (!meshNode) throw new Error("Mesh node failed to initialize");

	await meshNode.announceCapability("liop:manifest");

	const gateway = new LiopHybridGateway(server, meshNode, 50051);
	const port = await gateway.listen(3000);

	console.log(`[Oracle-Prod] Gateway active on port ${port}`);
	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15005/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "oracle.multiaddr"), p2pAddr);
	console.log(`[Oracle-Prod] Industrial Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[Oracle-Prod] Shutting down...");
		tickEngine.halt();
		tickEngine.stop();
		clearInterval(dataRefreshInterval);
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	setInterval(() => {
		gateway.getRouter().refreshManifestCache(true).catch(() => {});
	}, 15000);
}

main().catch((err) => {
	console.error("[Oracle-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
