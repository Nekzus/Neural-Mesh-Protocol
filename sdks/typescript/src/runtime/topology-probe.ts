// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Topology Probe — RFC 9728 PRM Chain & Adaptive Network Detection
 *
 * Implements single-URL auto-discovery of multi-tier mesh environments:
 * 1. Probes RFC 9728 Protected Resource Metadata (PRM) or /health endpoint.
 * 2. Chains discovery to obtain OAuth 2.1 authorization server endpoints.
 * 3. Identifies whether the node should operate in "gateway", "mesh", or "hybrid" mode.
 *
 * Standards: RFC 9728, RFC 8414, RFC 8707, NIST SP 800-207
 */

import { log } from "../utils/logger.js";

export interface GatewayTopologyInfo {
	baseUrl: string;
	mcpEndpoint: string;
	healthEndpoint: string;
	tokenEndpoint: string;
	issuer: string;
	audience: string;
	scopes: string[];
	tools: string[];
	tier: number;
}

export interface MeshTopologyInfo {
	bootstrapNodes: string[];
	identityPath?: string;
}

export interface TopologyProbeResult {
	mode: "gateway" | "mesh" | "hybrid";
	gateway?: GatewayTopologyInfo;
	mesh?: MeshTopologyInfo;
}

export interface TopologyProbeOptions {
	blgUrl?: string;
	nexusUrl?: string;
	clientId?: string;
	clientSecret?: string;
	audience?: string;
	staticToken?: string;
	bootstrapNodes?: string[];
	identityPath?: string;
	autoProbeLocal?: boolean;
}

/**
 * Executes the RFC 9728 PRM chain and health probe on a candidate Gateway URL.
 */
async function probeGatewayUrl(
	candidateUrl: string,
	options: TopologyProbeOptions,
): Promise<GatewayTopologyInfo | null> {
	const trimmedUrl = candidateUrl.replace(/\/+$/, "");
	const healthUrl = `${trimmedUrl}/health`;

	try {
		log.info(`[TopologyProbe] Probing candidate Gateway at: ${healthUrl}`);
		const healthRes = await fetch(healthUrl, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(3000),
		});

		if (!healthRes.ok) {
			log.info(
				`[TopologyProbe] Probe failed at ${healthUrl} [HTTP ${healthRes.status}]`,
			);
			return null;
		}

		const healthData = (await healthRes.json()) as {
			status?: string;
			tools?: string[];
			auth?: {
				issuer?: string;
				token_endpoint?: string;
				jwks_uri?: string;
			};
			topology?: {
				tier?: number;
			};
		};

		if (healthData.status !== "healthy") {
			return null;
		}

		// Discover OAuth metadata via PRM (RFC 9728)
		let issuer = healthData.auth?.issuer || "";
		let tokenEndpoint = healthData.auth?.token_endpoint || "";
		let audience = options.audience || "urn:liop:mesh:api";
		let scopes: string[] = [
			"liop:tools:list",
			"liop:tools:call",
			"liop:resources:read",
			"liop:schema:read",
			"liop:mesh:query",
		];

		try {
			const prmUrl = `${trimmedUrl}/.well-known/oauth-protected-resource`;
			const prmRes = await fetch(prmUrl, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(2000),
			});
			if (prmRes.ok) {
				const prmData = (await prmRes.json()) as {
					resource?: string;
					authorization_servers?: string[];
					scopes_supported?: string[];
				};
				if (prmData.resource) audience = prmData.resource;
				if (prmData.authorization_servers?.length) {
					issuer = prmData.authorization_servers[0];
				}
				if (prmData.scopes_supported?.length) {
					scopes = prmData.scopes_supported;
				}
			}
		} catch {
			// Non-fatal if PRM endpoint is not present
		}

		// If token endpoint is not explicitly given, resolve from issuer
		if (!tokenEndpoint && issuer) {
			const baseIssuer = issuer.endsWith("/oidc") ? issuer : `${issuer}/oidc`;
			tokenEndpoint = `${baseIssuer}/token`;
		}

		// Normalize tokenEndpoint for Docker-to-Host bridge environments
		if (tokenEndpoint) {
			try {
				const parsedEndpoint = new URL(tokenEndpoint);
				if (options.nexusUrl) {
					const nexusBase = options.nexusUrl.replace(/\/+$/, "");
					const nexusHost = new URL(nexusBase).host;
					parsedEndpoint.host = nexusHost;
					tokenEndpoint = parsedEndpoint.toString();
				} else if (
					(parsedEndpoint.hostname === "nexus" ||
						parsedEndpoint.hostname === "nexus-prod" ||
						parsedEndpoint.hostname.startsWith("172.")) &&
					trimmedUrl.includes("127.0.0.1")
				) {
					parsedEndpoint.host = "127.0.0.1:15000";
					tokenEndpoint = parsedEndpoint.toString();
				}
			} catch {
				/* keep original tokenEndpoint */
			}
		}

		log.info(
			`[TopologyProbe] ✅ Verified Gateway at ${trimmedUrl} (Tools: ${healthData.tools?.length ?? 0}, Tier: ${healthData.topology?.tier ?? 2})`,
		);

		return {
			baseUrl: trimmedUrl,
			mcpEndpoint: `${trimmedUrl}/mcp`,
			healthEndpoint: `${trimmedUrl}/health`,
			tokenEndpoint,
			issuer,
			audience,
			scopes,
			tools: healthData.tools || [],
			tier: healthData.topology?.tier ?? 2,
		};
	} catch (err) {
		log.info(
			`[TopologyProbe] Gateway probe unreachable at ${trimmedUrl}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

/**
 * Probes the runtime environment and determines the optimal architecture mode.
 */
export async function probeTopology(
	options: TopologyProbeOptions = {},
): Promise<TopologyProbeResult> {
	log.info("[TopologyProbe] Starting adaptive network topology discovery...");

	let gatewayInfo: GatewayTopologyInfo | null = null;

	// 1. Check explicit Border LIO Gateway URL (Highest priority)
	if (options.blgUrl) {
		gatewayInfo = await probeGatewayUrl(options.blgUrl, options);
	}

	// 2. Auto-probing known local infrastructure ports if enabled/unspecified
	if (!gatewayInfo && (options.autoProbeLocal ?? true)) {
		const candidateUrls = [
			"http://127.0.0.1:15018", // Production BLG port
			"http://127.0.0.1:15000", // Production Nexus port
			"http://127.0.0.1:13000", // Demo Nexus port
		];

		for (const url of candidateUrls) {
			// Skip if already probed
			if (options.blgUrl && url.includes(new URL(options.blgUrl).port))
				continue;

			gatewayInfo = await probeGatewayUrl(url, options);
			if (gatewayInfo) break;
		}
	}

	// 3. Evaluate P2P Mesh connectivity
	const bootstrapNodes = options.bootstrapNodes || [];
	const hasMeshBootstraps = bootstrapNodes.length > 0;

	// 4. Decide runtime mode
	if (gatewayInfo && hasMeshBootstraps) {
		log.info(
			`[TopologyProbe] ⚡ Mode Determined: HYBRID (Gateway: ${gatewayInfo.baseUrl} + ${bootstrapNodes.length} P2P bootstraps)`,
		);
		return {
			mode: "hybrid",
			gateway: gatewayInfo,
			mesh: {
				bootstrapNodes,
				identityPath: options.identityPath,
			},
		};
	}

	if (gatewayInfo) {
		log.info(
			`[TopologyProbe] 🚀 Mode Determined: GATEWAY (Zero-P2P overhead, direct to ${gatewayInfo.baseUrl})`,
		);
		return {
			mode: "gateway",
			gateway: gatewayInfo,
		};
	}

	log.info(
		`[TopologyProbe] 🌐 Mode Determined: MESH (Standard P2P DHT, Bootstraps: ${bootstrapNodes.length})`,
	);
	return {
		mode: "mesh",
		mesh: {
			bootstrapNodes,
			identityPath: options.identityPath,
		},
	};
}
