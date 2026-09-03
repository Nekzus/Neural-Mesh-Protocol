#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { multiaddr } from "@multiformats/multiaddr";
import { isLegacyRequest } from "../gateway/mcp-compat.js";
import { LiopMcpRouter } from "../gateway/router.js";
import { MeshNode } from "../mesh/index.js";
import { RoutingTable, type ToolDefinition } from "../runtime/routing-table.js";
import { TokenManager } from "../runtime/token-manager.js";
import {
	type GatewayTopologyInfo,
	type MeshTopologyInfo,
	probeTopology,
	type TopologyProbeResult,
} from "../runtime/topology-probe.js";
import { LiopServer } from "../server/index.js";
import type { McpRequest, McpResponse } from "../types.js";
import { log } from "../utils/logger.js";

/**
 * Mandatory Diagnostic Tool definition.
 * Claude Desktop silently hides the connector if it receives an empty array initially.
 */
const LIOP_MESH_STATUS_TOOL: ToolDefinition = {
	name: "LiopMeshStatus",
	description:
		"LiopMeshStatus: Returns the current dynamic diagnostic status of the Zero-Trust Neural Mesh.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

/**
 * Resolves a full libp2p multiaddr (with PeerID) from a LIOP node's
 * HTTP health endpoint.
 */
async function resolveBootstrapFromUrl(url: string): Promise<string | null> {
	try {
		const healthUrl = url.endsWith("/health") ? url : `${url}/health`;
		const response = await fetch(healthUrl, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) return null;

		const data = (await response.json()) as {
			mesh?: { multiaddrs?: string[]; peerId?: string };
		};
		if (!data.mesh?.multiaddrs?.length || !data.mesh?.peerId) return null;

		const tcpAddr = data.mesh.multiaddrs.find(
			(a: string) =>
				a.includes("/tcp/") &&
				!a.includes("/ws") &&
				!a.includes("/ip4/127.0.0.1/"),
		);
		if (!tcpAddr) return null;

		let resolved = shouldEnableDockerMap()
			? industrialAddressMapper(tcpAddr)
			: tcpAddr;
		if (!resolved || resolved === tcpAddr) {
			const urlHost = new URL(url).hostname;
			resolved = tcpAddr.replace(/\/ip4\/[^/]+/, `/ip4/${urlHost}`);
		}

		if (!resolved) return null;
		resolved += resolved.includes("/p2p/") ? "" : `/p2p/${data.mesh.peerId}`;
		return resolved;
	} catch {
		return null;
	}
}

/**
 * Normalizes a bootstrap multiaddr string to 127.0.0.1 for local Docker bridge resilience.
 */
function normalizeBootstrap(addr: string): string {
	const trimmed = addr.trim();
	const dockerIpRegex =
		/\/ip4\/172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]{1,3}\.[0-9]{1,3}/;
	const loopbackRegex = /\/ip4\/127\.0\.0\.1/;
	const physicalIpRegex = /\/ip4\/192\.168\.[0-9]{1,3}\.[0-9]{1,3}/;

	if (
		dockerIpRegex.test(trimmed) ||
		loopbackRegex.test(trimmed) ||
		physicalIpRegex.test(trimmed)
	) {
		const targetIp = "127.0.0.1";
		const normalized = trimmed
			.replace(dockerIpRegex, `/ip4/${targetIp}`)
			.replace(loopbackRegex, `/ip4/${targetIp}`)
			.replace(physicalIpRegex, `/ip4/${targetIp}`);

		if (normalized !== trimmed) {
			log.info(
				`[LIOP-Agent] 🔄 Local Routing Hack → Forced 127.0.0.1: ${normalized}`,
			);
		}
		return normalized;
	}

	return trimmed;
}

/**
 * Maps Docker-internal IPs to host-published ports for local environments.
 * Supports both legacy demo ports (13001-13005) and production tier ports (15001-15041).
 */
function industrialAddressMapper(addr: string): string | null {
	// Production Multi-Tier Mappings
	if (addr.includes("/ip4/172.23.0.10"))
		return addr.replace(
			/\/ip4\/172\.23\.0\.10\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/15001",
		);
	if (addr.includes("/ip4/172.23.0.20"))
		return addr.replace(
			/\/ip4\/172\.23\.0\.20\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/15011",
		);
	if (addr.includes("/ip4/172.21.0.13"))
		return addr.replace(
			/\/ip4\/172\.21\.0\.13\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/15031",
		);
	if (addr.includes("/ip4/172.21.0.14"))
		return addr.replace(
			/\/ip4\/172\.21\.0\.14\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/15041",
		);

	// Legacy Demo Cluster Mappings
	if (addr.includes("/ip4/172.20.0.10"))
		return addr.replace(
			/\/ip4\/172\.20\.0\.10\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/13001",
		);
	if (addr.includes("/ip4/172.20.0.11"))
		return addr.replace(
			/\/ip4\/172\.20\.0\.11\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/13003",
		);
	if (addr.includes("/ip4/172.20.0.12"))
		return addr.replace(
			/\/ip4\/172\.20\.0\.12\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/13004",
		);
	if (addr.includes("/ip4/172.20.0.13"))
		return addr.replace(
			/\/ip4\/172\.20\.0\.13\/tcp\/[0-9]+/,
			"/ip4/127.0.0.1/tcp/13005",
		);

	// Drop container-internal loopbacks
	if (
		addr.includes("/ip4/127.0.0.1/tcp/4000") ||
		addr.includes("/ip4/127.0.0.1/tcp/3000")
	) {
		return null;
	}

	return addr;
}

function isDockerDemoHost(urlStr: string): boolean {
	try {
		const u = new URL(urlStr);
		return (
			(u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
			(u.port === "13000" ||
				u.port === "13001" ||
				u.port === "15000" ||
				u.port === "15018")
		);
	} catch {
		return false;
	}
}

function shouldEnableDockerMap(): boolean {
	return (
		process.env.NODE_ENV === "development" ||
		process.env.NODE_ENV === "test" ||
		process.env.LIOP_DOCKER_MAP === "true" ||
		process.env.LIOP_DEV_MODE === "true" ||
		(!!process.env.LIOP_NEXUS_URL &&
			isDockerDemoHost(process.env.LIOP_NEXUS_URL))
	);
}

/**
 * Discovers P2P bootstrap nodes through physical beacons, env vars, and URL discovery.
 */
async function resolveBootstrapNodes(liopDir: string): Promise<string[]> {
	let bootstrapNodes: string[] = [];
	const args = process.argv.slice(2);
	if (args.length > 0) {
		bootstrapNodes = args.filter((a) => a.startsWith("/"));
	}

	if (bootstrapNodes.length === 0) {
		const searchDirs = [
			process.cwd(),
			path.join(process.cwd(), "tests/infra/nexus-data"),
			liopDir,
			path.join(
				path
					.dirname(new URL(import.meta.url).pathname)
					.replace(/^\/([A-Z]:)/, "$1"),
				"../../tests/infra/nexus-data",
			),
		];

		for (const dir of searchDirs) {
			try {
				if (fs.existsSync(dir)) {
					const files = fs.readdirSync(dir);
					const multiaddrFiles = files.filter((f) => f.endsWith(".multiaddr"));

					for (const file of multiaddrFiles) {
						const filePath = path.join(dir, file);
						const addr = fs.readFileSync(filePath, "utf8").trim();
						if (addr) {
							const normalized = normalizeBootstrap(addr);
							if (!bootstrapNodes.includes(normalized)) {
								bootstrapNodes.push(normalized);
								log.info(`[LIOP-Agent] ✅ Loaded beacon: ${file} from ${dir}`);
							}
						}
					}
					if (bootstrapNodes.length > 0) break;
				}
			} catch {
				/* ignore */
			}
		}
	}

	if (process.env.LIOP_NEXUS_URL) {
		const nexusUrl = process.env.LIOP_NEXUS_URL;
		const resolved = await resolveBootstrapFromUrl(nexusUrl);
		if (resolved) {
			const normalized = normalizeBootstrap(resolved);
			if (!bootstrapNodes.includes(normalized)) {
				bootstrapNodes.push(normalized);
				log.info(
					`[LIOP-Agent] ✅ Added bootstrap from URL discovery: ${normalized}`,
				);
			}
		}
	}

	if (bootstrapNodes.length === 0 && process.env.LIOP_BOOTSTRAP) {
		bootstrapNodes.push(process.env.LIOP_BOOTSTRAP.trim());
	}

	return bootstrapNodes.filter((addr) => {
		try {
			multiaddr(addr);
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * Dispatches an MCP request to an HTTP Gateway (BLG) with automatic token negotiation.
 */
async function forwardToGateway(
	mcpEndpoint: string,
	request: McpRequest,
	tokenManager: TokenManager,
): Promise<McpResponse> {
	const send = async (token?: string) => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		if (request.method) {
			headers["Mcp-Method"] = request.method;
		}
		const params = request.params as { name?: string } | undefined;
		if (params?.name) {
			headers["Mcp-Name"] = params.name;
		}

		return await fetch(mcpEndpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(30000),
		});
	};

	let token: string | undefined;
	try {
		token = await tokenManager.getToken();
	} catch (err) {
		log.warn(
			`[LIOP-Agent] Token acquisition warning: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let response = await send(token);

	// If 401 Unauthorized, invalidate token and retry once
	if (response.status === 401 && token) {
		log.info(
			"[LIOP-Agent] 🔄 401 received from Gateway. Refreshing token and retrying...",
		);
		tokenManager.invalidate();
		try {
			token = await tokenManager.getToken();
			response = await send(token);
		} catch {
			/* fallback to original error handling */
		}
	}

	if (!response.ok) {
		const errorBody = await response.text();
		let parsedError: Record<string, unknown> | null = null;
		try {
			parsedError = JSON.parse(errorBody);
		} catch {
			// not json
		}

		const errorObj = parsedError?.error as
			| { code?: number; message?: string }
			| undefined;
		return {
			jsonrpc: "2.0",
			id: request.id,
			error: {
				code: errorObj?.code ?? -32603,
				message:
					errorObj?.message ??
					`Gateway returned HTTP ${response.status}: ${errorBody}`,
			},
		};
	}

	return (await response.json()) as McpResponse;
}

/**
 * Operates in Mode 1: GATEWAY MODE.
 * Ultra-lightweight, sub-50ms startup, zero libp2p overhead.
 */
async function runGatewayMode(
	gateway: GatewayTopologyInfo,
	tokenManager: TokenManager,
	routingTable: RoutingTable,
) {
	log.info(
		`[LIOP-Agent] 🛡️ Running in ADAPTIVE GATEWAY MODE -> ${gateway.mcpEndpoint}`,
	);

	// Register known initial tools
	routingTable.registerLocalTool(LIOP_MESH_STATUS_TOOL);
	routingTable.registerGatewayTools(
		gateway.tools.map((t) => ({ name: t })),
		gateway.mcpEndpoint,
	);

	// Periodic tool refresh from /health to notify Claude of any changes
	let lastToolCount = gateway.tools.length;
	const pollInterval = setInterval(async () => {
		try {
			const res = await fetch(gateway.healthEndpoint, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(4000),
			});
			if (res.ok) {
				const data = (await res.json()) as { tools?: string[] };
				if (data.tools && data.tools.length !== lastToolCount) {
					log.info(
						`[LIOP-Agent] Gateway tools topology updated (${lastToolCount} -> ${data.tools.length})`,
					);
					lastToolCount = data.tools.length;
					routingTable.registerGatewayTools(
						data.tools.map((t) => ({ name: t })),
						gateway.mcpEndpoint,
					);
					process.stdout.write(
						`{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n`,
					);
					process.stdout.write(
						`{"jsonrpc":"2.0","method":"notifications/resources/list_changed"}\n`,
					);
				}
			}
		} catch {
			// ignore polling errors
		}
	}, 15000);

	const rl = readline.createInterface({
		input: process.stdin,
		terminal: false,
	});

	process.stdout.on("error", (err: Error & { code?: string }) => {
		if (err.code === "EPIPE") {
			clearInterval(pollInterval);
			process.exit(0);
		}
	});

	rl.on("line", async (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		let request: McpRequest;
		try {
			request = JSON.parse(trimmed);
		} catch {
			return;
		}

		const { id, method } = request;

		if (method === "server/discover") {
			const discoverResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
					supportedVersions: ["2026-07-28", "2025-11-25"],
					capabilities: {
						tools: { listChanged: true },
						resources: { listChanged: true, subscribe: true },
						prompts: { listChanged: true },
					},
					serverInfo: {
						name: "liop-adaptive-agent",
						version: "2.5.0",
					},
				},
			};
			process.stdout.write(`${JSON.stringify(discoverResponse)}\n`);
			return;
		}

		if (method === "initialize") {
			const clientVersion =
				(
					request.params as {
						protocolVersion?: string;
						_meta?: { "io.modelcontextprotocol/protocolVersion"?: string };
					}
				)?.protocolVersion ??
				(
					request.params as {
						_meta?: { "io.modelcontextprotocol/protocolVersion"?: string };
					}
				)?._meta?.["io.modelcontextprotocol/protocolVersion"];
			const protocolVersion =
				clientVersion === "2026-07-28" ? "2026-07-28" : "2025-11-25";

			const initResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion,
					capabilities: {
						tools: { listChanged: true },
						resources: { listChanged: true, subscribe: true },
						prompts: { listChanged: true },
					},
					serverInfo: {
						name: "liop-adaptive-agent",
						version: "2.5.0",
					},
				},
			};
			process.stdout.write(`${JSON.stringify(initResponse)}\n`);
			return;
		}

		if (
			method === "notifications/initialized" ||
			method === "notifications/cancelled"
		) {
			return;
		}

		if (method === "ping") {
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, result: {} })}\n`,
			);
			return;
		}

		if (method === "resources/templates/list") {
			const templatesResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
					ttlMs: 300_000,
					cacheScope: "public",
					resourceTemplates: [],
				},
			};
			process.stdout.write(`${JSON.stringify(templatesResponse)}\n`);
			return;
		}

		if (method === "subscriptions/listen") {
			const listenResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
				},
			};
			process.stdout.write(`${JSON.stringify(listenResponse)}\n`);
			return;
		}

		if (method === "tools/call") {
			const params = request.params as
				| { name?: string; arguments?: Record<string, unknown> }
				| undefined;
			if (params?.name === "LiopMeshStatus") {
				const statusResponse: McpResponse = {
					jsonrpc: "2.0",
					id,
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									mode: "adaptive-gateway",
									gatewayUrl: gateway.baseUrl,
									tier: gateway.tier,
									toolsAvailable: routingTable.getAllToolDefinitions().length,
									authenticated: true,
									status: "ONLINE",
								}),
							},
						],
					},
				};
				process.stdout.write(`${JSON.stringify(statusResponse)}\n`);
				return;
			}
		}

		try {
			const response = await forwardToGateway(
				gateway.mcpEndpoint,
				request,
				tokenManager,
			);

			// Inject LiopMeshStatus into tools/list if gateway does not list it
			if (
				method === "tools/list" &&
				response.result &&
				typeof response.result === "object"
			) {
				const resObj = response.result as Record<string, unknown>;
				const toolsList = resObj.tools as ToolDefinition[] | undefined;
				if (Array.isArray(toolsList)) {
					const hasStatus = toolsList.some((t) => t.name === "LiopMeshStatus");
					if (!hasStatus) {
						toolsList.unshift(LIOP_MESH_STATUS_TOOL);
					}
					// Update routing table with descriptions and schemas
					routingTable.registerGatewayTools(toolsList, gateway.mcpEndpoint);
				}

				if (!isLegacyRequest(request)) {
					if (!resObj.resultType) {
						resObj.resultType = "complete";
					}
					if (!resObj.ttlMs) {
						resObj.ttlMs = 300_000;
					}
					if (!resObj.cacheScope) {
						resObj.cacheScope = "public";
					}
				}
			}

			process.stdout.write(`${JSON.stringify(response)}\n`);
		} catch (err) {
			// Fallback resilience for tools/list
			if (method === "tools/list") {
				const isLegacy = isLegacyRequest(request);
				const fallbackResult = isLegacy
					? { tools: routingTable.getAllToolDefinitions() }
					: {
							resultType: "complete",
							ttlMs: 300_000,
							cacheScope: "public",
							tools: routingTable.getAllToolDefinitions(),
						};
				const fallbackResponse: McpResponse = {
					jsonrpc: "2.0",
					id,
					result: fallbackResult,
				};
				process.stdout.write(`${JSON.stringify(fallbackResponse)}\n`);
			} else {
				const errResponse: McpResponse = {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32603,
						message: `Forwarding failed: ${err instanceof Error ? err.message : String(err)}`,
					},
				};
				process.stdout.write(`${JSON.stringify(errResponse)}\n`);
			}
		}
	});

	rl.on("close", () => {
		clearInterval(pollInterval);
		process.exit(0);
	});
}

/**
 * Operates in Mode 2: MESH MODE.
 * Preserves full libp2p Kademlia DHT P2P discovery for decentralized environments.
 */
async function runMeshMode(mesh: MeshTopologyInfo) {
	log.info(
		`[LIOP-Agent] 🌐 Running in P2P MESH MODE (${mesh.bootstrapNodes.length} bootstraps)`,
	);

	const liopServer = new LiopServer({
		name: "@nekzus/liop",
		version: "2.5.0",
	});
	liopServer.enableZeroShotAutonomy();

	const meshNode = new MeshNode({
		identityPath: mesh.identityPath,
		bootstrapNodes: mesh.bootstrapNodes,
		addressMapper: shouldEnableDockerMap()
			? industrialAddressMapper
			: undefined,
	});

	await meshNode.start();
	const router = new LiopMcpRouter(liopServer, meshNode);

	router.onToolsChanged = () => {
		process.stdout.write(
			`{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n`,
		);
		process.stdout.write(
			`{"jsonrpc":"2.0","method":"notifications/resources/list_changed"}\n`,
		);
	};

	setTimeout(() => {
		router.refreshManifestCache(true).catch(() => {});
	}, 2000);

	const POLL_BASE_MS = 10_000;
	const POLL_MAX_MS = 120_000;
	let pollIntervalMs = POLL_BASE_MS;

	const scheduleAdaptivePoll = () => {
		setTimeout(async () => {
			const prevSize = router.getCacheSize();
			await router.refreshManifestCache(true).catch(() => {});
			const newSize = router.getCacheSize();

			if (newSize !== prevSize) {
				pollIntervalMs = POLL_BASE_MS;
			} else {
				pollIntervalMs = Math.min(
					Math.round(pollIntervalMs * 1.5),
					POLL_MAX_MS,
				);
			}
			scheduleAdaptivePoll();
		}, pollIntervalMs);
	};
	scheduleAdaptivePoll();

	const rl = readline.createInterface({
		input: process.stdin,
		terminal: false,
	});

	process.stdout.on("error", (err: Error & { code?: string }) => {
		if (err.code === "EPIPE") process.exit(0);
	});

	rl.on("line", async (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		try {
			const request = JSON.parse(trimmed) as McpRequest;
			if (request.method) {
				const response = await router.dispatch(request);
				if (response) {
					process.stdout.write(`${JSON.stringify(response)}\n`);
				}
			}
		} catch {
			/* ignore malformed lines */
		}
	});

	rl.on("close", () => process.exit(0));
	process.on("SIGINT", async () => {
		await meshNode.stop();
		process.exit(0);
	});
}

/**
 * Operates in Mode 3: HYBRID MODE.
 * Serves tools via Gateway and Mesh concurrently with per-tool dynamic routing.
 */
async function runHybridMode(
	topology: TopologyProbeResult,
	tokenManager: TokenManager,
	routingTable: RoutingTable,
) {
	const gateway = topology.gateway;
	const mesh = topology.mesh;
	if (!gateway || !mesh) {
		if (gateway) return runGatewayMode(gateway, tokenManager, routingTable);
		if (mesh) return runMeshMode(mesh);
		return;
	}

	log.info(
		`[LIOP-Agent] ⚡ Running in HYBRID MODE (Gateway: ${gateway.baseUrl} + Mesh P2P)`,
	);

	// Setup Gateway tools immediately for fast startup
	routingTable.registerLocalTool(LIOP_MESH_STATUS_TOOL);
	routingTable.registerGatewayTools(
		gateway.tools.map((t) => ({ name: t })),
		gateway.mcpEndpoint,
	);

	// Start P2P Mesh in background (Lazy Initialization)
	let meshNode: MeshNode | null = null;
	let router: LiopMcpRouter | null = null;

	const initMeshPromise = (async () => {
		try {
			const liopServer = new LiopServer({
				name: "@nekzus/liop-hybrid",
				version: "2.5.0",
			});
			liopServer.enableZeroShotAutonomy();

			meshNode = new MeshNode({
				identityPath: mesh.identityPath,
				bootstrapNodes: mesh.bootstrapNodes,
				addressMapper: shouldEnableDockerMap()
					? industrialAddressMapper
					: undefined,
			});
			await meshNode.start();
			router = new LiopMcpRouter(liopServer, meshNode);

			router.onToolsChanged = () => {
				process.stdout.write(
					`{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n`,
				);
				process.stdout.write(
					`{"jsonrpc":"2.0","method":"notifications/resources/list_changed"}\n`,
				);
			};

			await router.refreshManifestCache(true).catch(() => {});
			log.info("[LIOP-Agent] ✅ Background P2P Mesh initialization completed.");
		} catch (err) {
			log.warn(
				`[LIOP-Agent] Background Mesh init warning: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	})();

	const rl = readline.createInterface({
		input: process.stdin,
		terminal: false,
	});

	process.stdout.on("error", (err: Error & { code?: string }) => {
		if (err.code === "EPIPE") process.exit(0);
	});

	rl.on("line", async (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		let request: McpRequest;
		try {
			request = JSON.parse(trimmed);
		} catch {
			return;
		}

		const { id, method } = request;

		if (method === "server/discover") {
			const discoverResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
					supportedVersions: ["2026-07-28", "2025-11-25"],
					capabilities: {
						tools: { listChanged: true },
						resources: { listChanged: true, subscribe: true },
						prompts: { listChanged: true },
					},
					serverInfo: {
						name: "liop-hybrid-agent",
						version: "2.5.0",
					},
				},
			};
			process.stdout.write(`${JSON.stringify(discoverResponse)}\n`);
			return;
		}

		if (method === "initialize") {
			const clientVersion =
				(
					request.params as {
						protocolVersion?: string;
						_meta?: { "io.modelcontextprotocol/protocolVersion"?: string };
					}
				)?.protocolVersion ??
				(
					request.params as {
						_meta?: { "io.modelcontextprotocol/protocolVersion"?: string };
					}
				)?._meta?.["io.modelcontextprotocol/protocolVersion"];
			const protocolVersion =
				clientVersion === "2026-07-28" ? "2026-07-28" : "2025-11-25";

			const initResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion,
					capabilities: {
						tools: { listChanged: true },
						resources: { listChanged: true, subscribe: true },
						prompts: { listChanged: true },
					},
					serverInfo: {
						name: "liop-hybrid-agent",
						version: "2.5.0",
					},
				},
			};
			process.stdout.write(`${JSON.stringify(initResponse)}\n`);
			return;
		}

		if (
			method === "notifications/initialized" ||
			method === "notifications/cancelled"
		) {
			return;
		}

		if (method === "ping") {
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, result: {} })}\n`,
			);
			return;
		}

		if (method === "resources/templates/list") {
			const templatesResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
					ttlMs: 300_000,
					cacheScope: "public",
					resourceTemplates: [],
				},
			};
			process.stdout.write(`${JSON.stringify(templatesResponse)}\n`);
			return;
		}

		if (method === "subscriptions/listen") {
			const listenResponse: McpResponse = {
				jsonrpc: "2.0",
				id,
				result: {
					resultType: "complete",
				},
			};
			process.stdout.write(`${JSON.stringify(listenResponse)}\n`);
			return;
		}

		if (method === "tools/call") {
			const params = request.params as
				| { name?: string; arguments?: Record<string, unknown> }
				| undefined;
			const toolName = params?.name || "";

			const route = routingTable.resolve(toolName);
			if (route?.provider === "http-gateway") {
				const start = Date.now();
				try {
					const res = await forwardToGateway(
						gateway.mcpEndpoint,
						request,
						tokenManager,
					);
					routingTable.recordSuccess(toolName, Date.now() - start);
					process.stdout.write(`${JSON.stringify(res)}\n`);
					return;
				} catch (_err) {
					routingTable.recordFailure(toolName);
					log.warn(
						`[LIOP-Agent] Gateway call failed for '${toolName}'. Checking P2P fallback...`,
					);
				}
			}

			// P2P fallback or native P2P route
			await initMeshPromise;
			if (router) {
				const res = await router.dispatch(request);
				if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
				return;
			}
		}

		// By default, query gateway for tools/list and combine with mesh
		if (method === "tools/list") {
			let gatewayTools: ToolDefinition[] = [];
			try {
				const gwRes = await forwardToGateway(
					gateway.mcpEndpoint,
					request,
					tokenManager,
				);
				const resObj = gwRes.result as { tools?: ToolDefinition[] } | undefined;
				if (Array.isArray(resObj?.tools)) {
					gatewayTools = resObj.tools;
					routingTable.registerGatewayTools(gatewayTools, gateway.mcpEndpoint);
				}
			} catch {
				gatewayTools = routingTable.getAllToolDefinitions();
			}

			let meshTools: ToolDefinition[] = [];
			if (router) {
				const meshRes = await router.dispatch(request);
				const meshObj = meshRes?.result as
					| { tools?: ToolDefinition[] }
					| undefined;
				if (Array.isArray(meshObj?.tools)) {
					meshTools = meshObj.tools;
				}
			}

			// Merge distinct tools
			const toolMap = new Map<string, ToolDefinition>();
			toolMap.set("LiopMeshStatus", LIOP_MESH_STATUS_TOOL);
			for (const t of gatewayTools) toolMap.set(t.name, t);
			for (const t of meshTools)
				if (!toolMap.has(t.name)) toolMap.set(t.name, t);

			const merged = Array.from(toolMap.values()).sort((a, b) =>
				a.name.localeCompare(b.name),
			);

			const isLegacy = isLegacyRequest(request);
			const toolsResult = isLegacy
				? { tools: merged }
				: {
						resultType: "complete",
						ttlMs: 300_000,
						cacheScope: "public",
						tools: merged,
					};

			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, result: toolsResult })}\n`,
			);
			return;
		}

		// Other methods forward to gateway first, then mesh
		try {
			const res = await forwardToGateway(
				gateway.mcpEndpoint,
				request,
				tokenManager,
			);
			if (
				!isLegacyRequest(request) &&
				res.result &&
				typeof res.result === "object"
			) {
				const resObj = res.result as Record<string, unknown>;
				if (!resObj.resultType) {
					resObj.resultType = "complete";
				}
			}
			process.stdout.write(`${JSON.stringify(res)}\n`);
		} catch {
			await initMeshPromise;
			if (router) {
				const res = await router.dispatch(request);
				if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
			}
		}
	});

	rl.on("close", async () => {
		if (meshNode) await meshNode.stop();
		process.exit(0);
	});
}

/**
 * Main Entry Point
 */
async function main() {
	// Auto-Relaunch: Ensure system CA certificates are loaded for TLS compatibility
	if (
		(process.platform === "win32" || process.platform === "darwin") &&
		!process.execArgv.includes("--use-system-ca") &&
		!(process.env.NODE_OPTIONS ?? "").includes("--use-system-ca")
	) {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.execPath,
			["--use-system-ca", ...process.argv.slice(1)],
			{ stdio: "inherit", env: process.env },
		);
		child.on("exit", (code) => process.exit(code ?? 1));
		child.on("error", () => process.exit(1));
		await new Promise(() => {});
		return;
	}

	const buildTime = new Date().toISOString();
	log.info(
		`[LIOP-Agent] 🚀 Version 2.5.0 (Adaptive Zero-Config) | Build: ${buildTime}`,
	);

	const liopDir = path.join(os.homedir(), ".liop");
	const identityPath = path.join(liopDir, "identity.json");
	if (!fs.existsSync(liopDir)) {
		fs.mkdirSync(liopDir, { recursive: true });
	}

	// 1. Resolve candidate P2P bootstrap nodes
	const bootstrapNodes = await resolveBootstrapNodes(liopDir);

	// 2. Execute Adaptive Topology Probe
	const blgUrl = process.env.LIOP_BLG_URL;
	const nexusUrl = process.env.LIOP_NEXUS_URL;
	const clientId =
		process.env.LIOP_CLIENT_ID ||
		process.env.LIOP_OAUTH_CLIENT_ID ||
		"liop-agent";
	const clientSecret =
		process.env.LIOP_CLIENT_SECRET ||
		process.env.LIOP_OAUTH_CLIENT_SECRET ||
		"dev-secret-change-me";
	const staticToken = process.env.LIOP_TOKEN || process.env.LIOP_OAUTH_TOKEN;

	const topology = await probeTopology({
		blgUrl,
		nexusUrl,
		clientId,
		clientSecret,
		staticToken,
		bootstrapNodes,
		identityPath,
	});

	const routingTable = new RoutingTable();
	const tokenManager = new TokenManager({
		tokenEndpoint:
			topology.gateway?.tokenEndpoint ||
			`${nexusUrl || "http://127.0.0.1:15000"}/oidc/token`,
		clientId,
		clientSecret,
		audience: topology.gateway?.audience,
		scopes: topology.gateway?.scopes,
		staticToken,
	});

	// 3. Dispatch by Mode
	switch (topology.mode) {
		case "gateway":
			if (!topology.gateway)
				throw new Error(
					"Topology probe indicated gateway mode without gateway info.",
				);
			await runGatewayMode(topology.gateway, tokenManager, routingTable);
			break;
		case "mesh":
			if (!topology.mesh)
				throw new Error(
					"Topology probe indicated mesh mode without mesh info.",
				);
			await runMeshMode(topology.mesh);
			break;
		case "hybrid":
			await runHybridMode(topology, tokenManager, routingTable);
			break;
	}
}

main().catch((err) => {
	log.error(`[LIOP-Agent] Fatal Error: ${err.message}`);
	process.exit(1);
});
