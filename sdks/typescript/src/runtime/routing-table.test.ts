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
});
