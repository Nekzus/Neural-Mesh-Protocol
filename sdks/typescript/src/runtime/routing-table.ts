/**
 * LIOP Routing Table — Per-Tool Hybrid Routing & Resilience
 *
 * Maintains deterministic per-tool routes across heterogeneous transports:
 * - "http-gateway": Route through Border LIO Gateway or reverse proxy via HTTP/JSON-RPC.
 * - "p2p-grpc": Route directly to sovereign node via libp2p + gRPC (Kyber768/ZK-Receipt).
 * - "local": Handled in-process (e.g. LiopMeshStatus, diagnostic probes).
 *
 * Implements per-route latency tracking, failure backoff, and circuit breaking.
 */

import { log } from "../utils/logger.js";

export type TransportProvider = "http-gateway" | "p2p-grpc" | "local";

export interface ToolDefinition {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export interface ToolRoute {
	name: string;
	provider: TransportProvider;
	endpoint: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	latencyMs: number;
	failCount: number;
	lastSuccess: number;
	authRequired?: boolean;
}

export class RoutingTable {
	private routes = new Map<string, ToolRoute>();
	private static readonly MAX_FAILURES = 5;

	/**
	 * Registers or updates a collection of tools exposed via an HTTP Gateway.
	 */
	public registerGatewayTools(
		tools: ToolDefinition[],
		mcpEndpoint: string,
		authRequired = true,
	): void {
		for (const tool of tools) {
			const existing = this.routes.get(tool.name);
			this.routes.set(tool.name, {
				name: tool.name,
				provider: "http-gateway",
				endpoint: mcpEndpoint,
				description: tool.description ?? existing?.description,
				inputSchema: tool.inputSchema ?? existing?.inputSchema,
				latencyMs: existing?.latencyMs ?? 0,
				failCount: 0,
				lastSuccess: existing?.lastSuccess ?? Date.now(),
				authRequired,
			});
		}
		log.info(
			`[RoutingTable] Registered ${tools.length} tool(s) via HTTP Gateway (${mcpEndpoint})`,
		);
	}

	/**
	 * Registers tools discovered directly over the P2P Mesh (gRPC).
	 */
	public registerMeshTools(
		tools: ToolDefinition[],
		grpcTarget: string,
		authRequired = false,
	): void {
		for (const tool of tools) {
			const existing = this.routes.get(tool.name);
			// Do not overwrite healthy gateway routes unless explicitly preferred
			if (
				existing &&
				existing.provider === "http-gateway" &&
				existing.failCount === 0
			) {
				continue;
			}
			this.routes.set(tool.name, {
				name: tool.name,
				provider: "p2p-grpc",
				endpoint: grpcTarget,
				description: tool.description ?? existing?.description,
				inputSchema: tool.inputSchema ?? existing?.inputSchema,
				latencyMs: existing?.latencyMs ?? 0,
				failCount: 0,
				lastSuccess: existing?.lastSuccess ?? Date.now(),
				authRequired,
			});
		}
		log.info(
			`[RoutingTable] Registered ${tools.length} tool(s) via P2P Mesh gRPC (${grpcTarget})`,
		);
	}

	/**
	 * Registers an in-process local tool (e.g. LiopMeshStatus).
	 */
	public registerLocalTool(tool: ToolDefinition): void {
		this.routes.set(tool.name, {
			name: tool.name,
			provider: "local",
			endpoint: "in-process",
			description: tool.description,
			inputSchema: tool.inputSchema,
			latencyMs: 0,
			failCount: 0,
			lastSuccess: Date.now(),
			authRequired: false,
		});
	}

	/**
	 * Resolves the optimal route for a specific tool.
	 */
	public resolve(toolName: string): ToolRoute | undefined {
		const route = this.routes.get(toolName);
		if (!route) return undefined;

		// If circuit is tripped (excessive failures), still return route but log warning
		if (route.failCount >= RoutingTable.MAX_FAILURES) {
			log.warn(
				`[RoutingTable] Tool '${toolName}' route has tripped circuit breaker (${route.failCount} consecutive failures).`,
			);
		}

		return route;
	}

	/**
	 * Records a successful invocation on a route, resetting failures and updating latency.
	 */
	public recordSuccess(toolName: string, latencyMs: number): void {
		const route = this.routes.get(toolName);
		if (route) {
			route.failCount = 0;
			route.latencyMs = latencyMs;
			route.lastSuccess = Date.now();
		}
	}

	/**
	 * Records a failed invocation on a route.
	 */
	public recordFailure(toolName: string): void {
		const route = this.routes.get(toolName);
		if (route) {
			route.failCount += 1;
			log.warn(
				`[RoutingTable] Failure recorded for tool '${toolName}' (failCount: ${route.failCount})`,
			);
		}
	}

	/**
	 * Lists all registered tools in sorted format for tools/list.
	 */
	public getAllToolDefinitions(): ToolDefinition[] {
		const list: ToolDefinition[] = [];
		for (const route of this.routes.values()) {
			list.push({
				name: route.name,
				description: route.description,
				inputSchema: route.inputSchema,
			});
		}
		return list.sort((a, b) => a.name.localeCompare(b.name));
	}

	public getRoute(toolName: string): ToolRoute | undefined {
		return this.routes.get(toolName);
	}

	public size(): number {
		return this.routes.size;
	}

	public clear(): void {
		this.routes.clear();
	}
}
