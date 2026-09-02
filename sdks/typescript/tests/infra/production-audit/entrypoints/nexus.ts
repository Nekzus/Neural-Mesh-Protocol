/**
 * LIOP Nexus Node — Bootstrap Seed (Production Package Audit)
 *
 * Runs the published @nekzus/liop package in a realistic WAN environment.
 * Sole purpose: Peer discovery and DHT seed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const liopServer = new LiopServer(
		{
			name: "LIOP-Nexus-Production",
			version: "2.5.0",
		},
		{
			auth: {
				role: "nexus",
			},
		},
	);

	await liopServer.connectToMesh({
		port: 50051,
		meshConfig: {
			identityPath: path.join(dataDir, "nexus-identity.json"),
			listenAddresses: [
				"/ip4/0.0.0.0/tcp/4000",
				"/ip4/0.0.0.0/tcp/4001/ws",
			],
			bootstrapNodes: [], // Nexus is the seed
		},
	});

	const meshNode = liopServer.getMeshNode();
	if (meshNode) {
		const peerId = meshNode.getPeerId();
		const p2pAddr = `/ip4/127.0.0.1/tcp/15001/p2p/${peerId}`;
		fs.writeFileSync(path.join(dataDir, "nexus.multiaddr"), p2pAddr);
		console.log(`[Nexus-Prod] Industrial Beacon exported: ${p2pAddr}`);
	}

	const gateway = new LiopHybridGateway(liopServer, liopServer.getMeshNode() || undefined);
	const port = await gateway.listen(3000);
	console.log(`[Nexus-Prod] Gateway active on port ${port}`);

	const shutdown = async () => {
		console.log("[Nexus-Prod] Shutdown signal received. Closing servers...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("[Nexus-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
