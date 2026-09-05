// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { MCP_LEGACY_SUPPORT_ENABLED } from "../gateway/mcp-compat.js";
import type { LiopServer } from "../server/index.js";
import { log } from "../utils/logger.js";
import { LiopMcpBridge } from "./index.js";

/**
 * Configuration options for LiopStreamBridge.
 */
export interface LiopStreamBridgeOptions {
	/** Port to listen on (default: 3000) */
	port?: number;
	/** Max concurrent sessions per IP (default: 5) */
	maxSessionsPerIp?: number;
	/** Session idle timeout in milliseconds (default: 30 min) */
	sessionTimeoutMs?: number;
}

/**
 * @mcp-legacy Internal metadata for tracked legacy sessions (2025-era).
 * Remove when v1 EOL.
 */
interface SessionEntry {
	transport: WebStandardStreamableHTTPServerTransport;
	lastActivity: number;
	clientIp: string;
}

const DEFAULT_MAX_SESSIONS_PER_IP = 10;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const EVICTION_INTERVAL_MS = 60 * 1000; // Check every minute

/**
 * LiopStreamBridge
 *
 * Exposes a LiopServer over a remote HTTP network using the industry-standard
 * MCP Streamable HTTP Transport + Hono JS.
 *
 * Supports concurrent multi-client connections via per-session transport instances (Map pattern).
 * External agents connect using only a URL + Bearer Token (Zero-Trust).
 *
 * Security hardening:
 * - Zero-Trust Bearer Token enforcement
 * - Per-IP rate limiting on session creation
 * - Automatic eviction of idle sessions (TTL)
 */
export class LiopStreamBridge {
	private app: Hono;
	private httpServer: ReturnType<typeof serve> | null = null;
	private bridgeLogic: LiopMcpBridge;
	private activeSessions: Map<string, SessionEntry>;
	private evictionTimer: ReturnType<typeof setInterval> | null = null;
	private maxSessionsPerIp: number;
	private sessionTimeoutMs: number;

	constructor(
		internalServer: LiopServer,
		private options: LiopStreamBridgeOptions = {},
	) {
		this.app = new Hono();
		this.bridgeLogic = new LiopMcpBridge(internalServer);
		this.activeSessions = new Map();
		this.maxSessionsPerIp =
			options.maxSessionsPerIp ?? DEFAULT_MAX_SESSIONS_PER_IP;
		this.sessionTimeoutMs =
			options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;

		this.setupRoutes();
	}

	/**
	 * Creates a new per-session transport instance and wires it to the LIOPMcpBridge logic.
	 */
	private async createSessionTransport(
		clientIp: string,
	): Promise<WebStandardStreamableHTTPServerTransport> {
		const { WebStandardStreamableHTTPServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (sessionId: string) => {
				this.activeSessions.set(sessionId, {
					transport,
					lastActivity: Date.now(),
					clientIp,
				});
				log.info(
					`[LIOP-StreamBridge] Session opened: ${sessionId} (IP: ${clientIp})`,
				);
			},
		});

		// Wire the transport's incoming messages to the LiopMcpBridge JSON-RPC router
		transport.onmessage = async (message: JSONRPCMessage) => {
			// Touch activity timestamp on every message
			if (transport.sessionId) {
				const entry = this.activeSessions.get(transport.sessionId);
				if (entry) entry.lastActivity = Date.now();
			}

			try {
				const result = await this.bridgeLogic.handleJsonRpcRequest(
					message as unknown as Record<string, unknown>,
				);
				// Notifications return undefined — no response needed
				if (result !== undefined) {
					await transport.send(result as JSONRPCMessage);
				}
			} catch (err: unknown) {
				log.info("[LIOP-StreamBridge] JSON-RPC error:", (err as Error).message);
			}
		};

		transport.onclose = () => {
			if (transport.sessionId) {
				this.activeSessions.delete(transport.sessionId);
				log.info(`[LIOP-StreamBridge] Session closed: ${transport.sessionId}`);
			}
		};

		return transport;
	}

	/**
	 * Returns the number of active sessions for a given IP.
	 */
	private countSessionsByIp(ip: string): number {
		let count = 0;
		for (const entry of this.activeSessions.values()) {
			if (entry.clientIp === ip) count++;
		}
		return count;
	}

	/**
	 * Extracts client IP from the request (supports X-Forwarded-For for reverse proxies).
	 */
	private getClientIp(c: {
		req: { header: (name: string) => string | undefined };
	}): string {
		return (
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
			c.req.header("x-real-ip") ||
			"unknown"
		);
	}

	/**
	 * Evicts sessions that have been idle longer than the configured timeout.
	 */
	private evictIdleSessions(): void {
		const now = Date.now();
		for (const [sessionId, entry] of this.activeSessions) {
			if (now - entry.lastActivity > this.sessionTimeoutMs) {
				log.info(`[LIOP-StreamBridge] Evicting idle session: ${sessionId}`);
				entry.transport.close().catch(() => {
					/* Swallow close errors */
				});
				this.activeSessions.delete(sessionId);
			}
		}
	}

	private setupRoutes() {
		this.app.use("*", cors());

		// Initialize strict zero-trust token if not provided
		if (!process.env.ZERO_TRUST_TOKEN) {
			process.env.ZERO_TRUST_TOKEN = randomUUID();
			log.info("=".repeat(60));
			log.info("⚠️ STRICT ZERO-TRUST MODE ENABLED ⚠️");
			log.info("No ZERO_TRUST_TOKEN found in environment.");
			log.info("A secure ephemeral token has been generated for this session:");
			log.info(`Token: ${process.env.ZERO_TRUST_TOKEN}`);
			log.info("=".repeat(60));
		}

		// ZTA (Zero-Trust Architecture) Security Middleware
		this.app.use("/mcp", async (c, next) => {
			const auth = c.req.header("Authorization");
			if (!auth?.startsWith("Bearer ")) {
				return c.json(
					{ error: "Unauthorized: LIOP Zero-Trust Policy Enforced" },
					401,
				);
			}

			const token = auth.slice(7);
			const expectedToken = process.env.ZERO_TRUST_TOKEN;

			// Check static token fallback first (retrocompatibility)
			if (expectedToken && token === expectedToken) {
				await next();
				return;
			}

			// Validate with JWT Validator if configured on the server
			const jwtValidator = this.bridgeLogic.getServer()?.jwtValidator;
			if (jwtValidator) {
				try {
					await jwtValidator.validate(token);
					await next();
					return;
				} catch (e: unknown) {
					log.info(
						`[LIOP-StreamBridge] JWT Validation failed: ${(e as Error).message}`,
					);
					return c.json(
						{
							error: `Unauthorized: JWT Validation failed - ${(e as Error).message}`,
						},
						401,
					);
				}
			}

			log.info(
				"[LIOP-StreamBridge] ALERT: Access denied - Invalid Zero-Trust token.",
			);
			return c.json(
				{ error: "Unauthorized: LIOP Zero-Trust Policy Enforced" },
				401,
			);
		});

		// MCP Streamable HTTP & Stateless Handler
		this.app.all("/mcp", async (c) => {
			const sessionId = c.req.header("mcp-session-id");

			// Route to existing session if legacy session ID is present
			if (sessionId) {
				/** @mcp-legacy Route to session if legacy session ID present. Remove when v1 EOL. */
				if (!MCP_LEGACY_SUPPORT_ENABLED) {
					return c.json(
						{
							error:
								"Session-based routing is retired. Use stateless MCP 2026-07-28 requests.",
						},
						404,
					);
				}

				const existing = this.activeSessions.get(sessionId);
				if (!existing) {
					return c.json({ error: "Session not found" }, 404);
				}
				// Touch activity on every routed request
				existing.lastActivity = Date.now();

				const response = await existing.transport.handleRequest(c.req.raw);

				// If DELETE, the transport closes internally but onclose may not fire.
				// Explicitly clean up the session from the Map.
				if (c.req.method === "DELETE") {
					this.activeSessions.delete(sessionId);
					log.info(`[LIOP-StreamBridge] Session closed (DELETE): ${sessionId}`);
				}

				return response;
			}

			// Stateless direct JSON-RPC POST (MCP v2 modern era)
			const contentType = c.req.header("content-type") || "";
			if (c.req.method === "POST" && contentType.includes("application/json")) {
				try {
					const body = (await c.req.json()) as Record<string, unknown>;
					// If this is a modern request or non-session JSON-RPC
					if (
						body.method === "server/discover" ||
						(body.params as Record<string, unknown>)?._meta ||
						!MCP_LEGACY_SUPPORT_ENABLED
					) {
						const result = await this.bridgeLogic.handleJsonRpcRequest(body);
						if (result !== undefined) {
							return c.json(result);
						}
						return c.body(null, 204);
					}
				} catch {
					// Fall through to legacy transport if JSON parsing fails or payload is streaming handshake
				}
			}

			// No session ID → Legacy Client initializing via WebStandardStreamableHTTPServerTransport
			/** @mcp-legacy Create legacy session transport. Remove when v1 EOL. */
			if (!MCP_LEGACY_SUPPORT_ENABLED) {
				return c.json(
					{
						error:
							"Stateless MCP 2026-07-28 is active. Direct JSON-RPC POST required.",
					},
					400,
				);
			}

			const clientIp = this.getClientIp(c);
			const currentSessions = this.countSessionsByIp(clientIp);
			if (currentSessions >= this.maxSessionsPerIp) {
				log.info(
					`[LIOP-StreamBridge] Rate limit hit for IP: ${clientIp} (${currentSessions} sessions)`,
				);
				return c.json({ error: "Too Many Sessions: Rate limit exceeded" }, 429);
			}

			const transport = await this.createSessionTransport(clientIp);
			return await transport.handleRequest(c.req.raw);
		});
	}

	/**
	 * Starts the LiopStreamBridge HTTP server and session eviction timer.
	 */
	public async start(port?: number): Promise<void> {
		const listenPort = port ?? this.options.port ?? 3000;

		// Start the idle session eviction timer
		this.evictionTimer = setInterval(
			() => this.evictIdleSessions(),
			EVICTION_INTERVAL_MS,
		);

		return new Promise((resolve) => {
			this.httpServer = serve(
				{
					fetch: this.app.fetch,
					port: listenPort,
				},
				(info) => {
					log.info(
						`[LIOP-StreamBridge] Streamable HTTP Gateway on http://localhost:${info.port}/mcp`,
					);
					resolve();
				},
			);
		});
	}

	/**
	 * Graceful shutdown — closes all active sessions, stops timers, and releases port.
	 */
	public async stop(): Promise<void> {
		if (this.evictionTimer) {
			clearInterval(this.evictionTimer);
			this.evictionTimer = null;
		}

		for (const [id, entry] of this.activeSessions) {
			await entry.transport.close();
			this.activeSessions.delete(id);
		}

		if (this.httpServer) {
			this.httpServer.close();
			log.info("[LIOP-StreamBridge] HTTP ports released.");
		}
	}
}
