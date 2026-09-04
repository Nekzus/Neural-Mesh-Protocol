/**
 * RoutingTable Test Suite — Hybrid Multi-Transport Routing
 */

import { describe, expect, it } from "vitest";
import { RoutingTable } from "./routing-table.js";

describe("RoutingTable", () => {
	it("should register and resolve gateway tools", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[
				{
					name: "BLG_Execute_Healthcare_Analytics",
					description: "Health analytics",
				},
				{ name: "BLG_Inspect_Enclave_Perimeter" },
			],
			"http://127.0.0.1:15018/mcp",
		);

		expect(table.size()).toBe(2);
		const route = table.resolve("BLG_Execute_Healthcare_Analytics");
		expect(route).toBeDefined();
		expect(route?.provider).toBe("http-gateway");
		expect(route?.endpoint).toBe("http://127.0.0.1:15018/mcp");
		expect(route?.description).toBe("Health analytics");
	});

	it("should register and resolve P2P mesh tools", () => {
		const table = new RoutingTable();
		table.registerMeshTools(
			[{ name: "PublicOracle_MarketData" }],
			"172.21.0.13:50051",
		);

		const route = table.resolve("PublicOracle_MarketData");
		expect(route).toBeDefined();
		expect(route?.provider).toBe("p2p-grpc");
		expect(route?.endpoint).toBe("172.21.0.13:50051");
	});

	it("should register local tools", () => {
		const table = new RoutingTable();
		table.registerLocalTool({
			name: "LiopMeshStatus",
			description: "Status check",
		});

		const route = table.resolve("LiopMeshStatus");
		expect(route).toBeDefined();
		expect(route?.provider).toBe("local");
		expect(route?.endpoint).toBe("in-process");
	});

	it("should track latency and reset failures on success", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "TestTool" }],
			"http://127.0.0.1:15018/mcp",
		);

		table.recordFailure("TestTool");
		table.recordFailure("TestTool");
		let route = table.resolve("TestTool");
		expect(route?.failCount).toBe(2);

		table.recordSuccess("TestTool", 45);
		route = table.resolve("TestTool");
		expect(route?.failCount).toBe(0);
		expect(route?.latencyMs).toBe(45);
	});

	it("should sort all tool definitions alphabetically", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "ZetaTool" }, { name: "AlphaTool" }, { name: "BetaTool" }],
			"http://127.0.0.1:15018/mcp",
		);

		const all = table.getAllToolDefinitions();
		expect(all.map((t) => t.name)).toEqual([
			"AlphaTool",
			"BetaTool",
			"ZetaTool",
		]);
	});

	it("should trip circuit breaker after 5 consecutive failures but still return route for caller handling", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "FragileService" }],
			"http://127.0.0.1:15018/mcp",
		);

		for (let i = 0; i < 5; i++) {
			table.recordFailure("FragileService");
		}

		const route = table.resolve("FragileService");
		expect(route).toBeDefined();
		expect(route?.failCount).toBe(5);
		expect(route?.failCount).toBeGreaterThanOrEqual(5);
	});

	it("should reset failure count to 0 upon successful invocation", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "RecoveringService" }],
			"http://127.0.0.1:15018/mcp",
		);

		table.recordFailure("RecoveringService");
		table.recordFailure("RecoveringService");
		table.recordFailure("RecoveringService");
		expect(table.resolve("RecoveringService")?.failCount).toBe(3);

		table.recordSuccess("RecoveringService", 35);
		const recovered = table.resolve("RecoveringService");
		expect(recovered?.failCount).toBe(0);
		expect(recovered?.latencyMs).toBe(35);
	});

	it("should preserve healthy gateway route when mesh tools with same name are announced", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "UnifiedTool" }],
			"http://127.0.0.1:15018/mcp",
		);

		// Attempt to register via mesh while gateway route has 0 failures
		table.registerMeshTools([{ name: "UnifiedTool" }], "172.21.0.10:50051");

		const route = table.resolve("UnifiedTool");
		expect(route?.provider).toBe("http-gateway");
		expect(route?.endpoint).toBe("http://127.0.0.1:15018/mcp");
	});

	it("should fallback to mesh route when gateway route has failures", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "FailoverTool" }],
			"http://127.0.0.1:15018/mcp",
		);

		// Record a failure on the gateway route
		table.recordFailure("FailoverTool");
		expect(table.resolve("FailoverTool")?.failCount).toBe(1);

		// Now register mesh tool — should overwrite the degraded gateway route
		table.registerMeshTools([{ name: "FailoverTool" }], "172.21.0.15:50051");

		const route = table.resolve("FailoverTool");
		expect(route?.provider).toBe("p2p-grpc");
		expect(route?.endpoint).toBe("172.21.0.15:50051");
		expect(route?.failCount).toBe(0);
	});

	it("should return undefined for unregistered tools", () => {
		const table = new RoutingTable();
		expect(table.resolve("NonExistentTool")).toBeUndefined();
	});

	it("should accurately track latency across multiple success reports", () => {
		const table = new RoutingTable();
		table.registerGatewayTools(
			[{ name: "LatencyTool" }],
			"http://127.0.0.1:15018/mcp",
		);

		table.recordSuccess("LatencyTool", 120);
		expect(table.resolve("LatencyTool")?.latencyMs).toBe(120);

		table.recordSuccess("LatencyTool", 45);
		expect(table.resolve("LatencyTool")?.latencyMs).toBe(45);
	});
});
