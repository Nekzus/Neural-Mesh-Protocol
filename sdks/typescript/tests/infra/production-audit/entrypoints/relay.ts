/**
 * LIOP Circuit Relay Node — Dedicated Intermediary for NAT Traversal (Production Audit)
 *
 * Runs the published @nekzus/liop package in a moderate latency environment.
 * Evaluates libp2p Circuit Relay v2 and hole-punching facilitation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const server = new LiopServer(
		{
			name: "PRODUCTION-circuit-relay",
			version: "2.5.0",
		},
		{
			auth: {
				role: "nexus",
			},
			taxonomy: {
				domain: "Infrastructure & NAT Traversal (CIRCUIT RELAY V2)",
				clearanceTier: 1,
				executionTypes: ["Relay Hop", "DHT Routing"],
			},
		},
	);

	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER || "/ip4/172.21.0.10/tcp/4000";

	await server.connectToMesh({
		port: 50051,
		meshConfig: {
			identityPath: path.join(dataDir, "relay-identity.json"),
			listenAddresses: [
				"/ip4/0.0.0.0/tcp/4000",
				"/ip4/0.0.0.0/tcp/4001/ws",
			],
			bootstrapNodes: [bootstrapSeed],
		},
	});

	const meshNode = server.getMeshNode();
	if (!meshNode) throw new Error("MeshNode failed to initialize on Relay");

	const gateway = new LiopHybridGateway(server, meshNode, 50051);
	const port = await gateway.listen(3000);

	console.log(`[Relay-Prod] Gateway active on port ${port}`);
	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15007/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "relay.multiaddr"), p2pAddr);
	console.log(`[Relay-Prod] Relay Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[Relay-Prod] Shutdown signal received...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("[Relay-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
