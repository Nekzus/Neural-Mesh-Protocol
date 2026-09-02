/**
 * LIOP Edge IoT Node — Hostile Network Remote Provider (Production Package Audit)
 *
 * Runs the published @nekzus/liop package in a severely degraded network
 * (300ms latency, 3% packet loss, 5% jitter) simulating edge/IoT gateways.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { LiopServer, LiopHybridGateway } from "@nekzus/liop";

function generateSensorTelemetry(count = 1000) {
	const sensors = ["SENSOR-TEMP-01", "SENSOR-VIBE-02", "SENSOR-PRES-03", "SENSOR-RPM-04"];
	const statuses = ["NOMINAL", "WARNING", "MAINTENANCE", "CRITICAL"];
	const records: Record<string, unknown>[] = [];

	for (let i = 0; i < count; i++) {
		const sensor = sensors[i % sensors.length];
		const temp = Number.parseFloat((20.0 + Math.random() * 85.0).toFixed(2));
		const vibration = Number.parseFloat((0.1 + Math.random() * 4.5).toFixed(3));
		const pressure = Number.parseFloat((1.0 + Math.random() * 9.0).toFixed(2));
		const status = statuses[i % statuses.length];

		records.push({
			id: `EDGE-${1000 + i}`,
			sensorId: sensor,
			timestamp: Date.now() - (i * 1000),
			temperatureCelsius: temp,
			vibrationMmPerSec: vibration,
			pressureBar: pressure,
			status,
		});
	}
	return records;
}

async function main() {
	const dataDir = "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const server = new LiopServer(
		{
			name: "PRODUCTION-edge-iot",
			version: "2.5.0",
		},
		{
			tokenSlug: "EDGE",
			auth: {
				role: "node",
				nexusUrl: "http://nexus:3000",
			},
			taxonomy: {
				domain: "Industrial IoT & SCADA Telemetry (HOSTILE 3G SIMULATION)",
				clearanceTier: 2,
				executionTypes: ["Edge Logic Injection", "Differential Privacy"],
			},
		},
	);

	const telemetry = generateSensorTelemetry(1500);
	console.log(`[Edge-Prod] Loaded ${telemetry.length} industrial sensor telemetry records`);
	server.setSandboxData(telemetry);

	server.dataDictionary(
		{
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", description: "Telemetry unique ID" },
					sensorId: { type: "string", description: "Edge hardware identifier" },
					timestamp: { type: "number", description: "Epoch millisecond sample time" },
					temperatureCelsius: { type: "number", description: "Temperature in Celsius" },
					vibrationMmPerSec: { type: "number", description: "Vibration velocity (RMS)" },
					pressureBar: { type: "number", description: "Hydraulic pressure in Bar" },
					status: { type: "string", description: "NOMINAL, WARNING, MAINTENANCE, CRITICAL" },
				},
			},
		},
		"Industrial IoT Telemetry Schema",
		"LIOP://schema/industrial-iot-telemetry",
	);

	const edgeAggregatedOutputSchema = z
		.object({
			totalSamples: z.number().optional(),
			avgTemperature: z.union([z.number(), z.string()]).optional(),
			maxTemperature: z.number().optional(),
			criticalCount: z.number().optional(),
			statusDistribution: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
			clientPayload: z.string().optional(),
		})
		.catchall(z.union([z.number(), z.string(), z.boolean()]));

	server.tool(
		"Analyze_IoT_Sensor_Data",
		"Production Audit: Securely processes edge industrial telemetry on-origin under severe 3G packet loss and jitter.",
		{ payload: z.string() },
		async (_params) => {
			return {
				content: [
					{
						type: "text",
						text: "[LIOP] Security Enforcement: Legacy tool blocked on Edge node. Wrap in @LIOP envelope to execute logic in WASI sandbox.",
					},
				],
				isError: true,
			};
		},
		{
			enforceAggregationFirst: true,
			outputSchema: edgeAggregatedOutputSchema,
			dpEpsilon: 2.0,
			dpSensitivity: 10.0,
			sensitiveKeys: ["sensorId"],
		},
	);

	const bootstrapSeed = process.env.LIOP_BOOTSTRAP_PEER || "/ip4/172.21.0.10/tcp/4000";

	await server.connectToMesh({
		port: 50051,
		meshConfig: {
			listenAddresses: ["/ip4/0.0.0.0/tcp/4000"],
			identityPath: path.join(dataDir, "edge-identity.json"),
			bootstrapNodes: [bootstrapSeed],
		},
	});

	const meshNode = server.getMeshNode();
	if (!meshNode) throw new Error("MeshNode failed to initialize on Edge");

	await meshNode.announceCapability("liop:manifest");

	const gateway = new LiopHybridGateway(server, meshNode, 50051);
	const port = await gateway.listen(3000);

	console.log(`[Edge-Prod] Gateway active on port ${port}`);
	const peerId = meshNode.getPeerId();
	const p2pAddr = `/ip4/127.0.0.1/tcp/15006/p2p/${peerId}`;
	fs.writeFileSync(path.join(dataDir, "edge.multiaddr"), p2pAddr);
	console.log(`[Edge-Prod] Industrial Beacon exported: ${p2pAddr}`);

	const shutdown = async () => {
		console.log("[Edge-Prod] Shutdown signal received...");
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("[Edge-Prod] Fatal error in entrypoint:", err);
	process.exit(1);
});
