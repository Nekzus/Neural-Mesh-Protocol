import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import type { MeshNode } from "../mesh/index.js";
import {
	manifestCacheSize,
	meshPeersConnected,
	protocolMetrics,
} from "../observability/metrics.js";
import type { AuthInfo, JwtValidator } from "../security/jwt-validator.js";
import { buildProtectedResourceMetadata } from "../security/prm.js";
import type { LiopServer } from "../server/index.js";
import { log } from "../utils/logger.js";
import {
	dispatchGrpcWebRequest,
	GRPC_WEB_CONSTANTS,
	isGrpcWebRequest,
} from "./grpc-web.js";
import {
	InMemoryRateLimiter,
	type RateLimiterOptions,
} from "./rate-limiter.js";
import { LiopMcpRouter } from "./router.js";

/**
 * LIOP Hybrid Gateway
 * High-level orchestration for connecting MCP (JSON-RPC) clients to the LIOP Mesh.
 */
export class LiopHybridGateway {
	private netServer: net.Server;
	private h2Server: http2.Http2Server;
	private h1Server: http.Server;
	private router: LiopMcpRouter;
	private jwtValidator?: JwtValidator;
	// biome-ignore lint/suspicious/noExplicitAny: oidc-provider is loaded in Phase C
	private oauthProvider?: any;
	private rateLimiter: InMemoryRateLimiter;
	private isDraining = false;
	private activeRequests = 0;

	constructor(
		private liopServer: LiopServer,
		private meshNode: MeshNode | null = null,
		rpcPort: number = 50051,
		rateLimiterOptions?: RateLimiterOptions,
	) {
		this.jwtValidator = this.liopServer.jwtValidator;
		this.oauthProvider = this.liopServer.oauthProvider;
		this.rateLimiter = new InMemoryRateLimiter(rateLimiterOptions);

		// Initialize the Universal Router
		this.router = new LiopMcpRouter(this.liopServer, this.meshNode, rpcPort);

		// Internal HTTP/2 Server (for Native gRPC Proxying)
		this.h2Server = http2.createServer();
		this.setupH2Routes();

		// Internal HTTP/1 Server (for Browser/MCP)
		this.h1Server = http.createServer();
		this.setupH1Routes();

		// Primary Multiplexer (L4)
		this.netServer = net.createServer((socket) => {
			socket.once("data", (buffer) => {
				const isHttp2 = buffer.toString().startsWith("PRI * HTTP/2.0");
				log.info(
					`[LIOP-Gateway] Incoming L4 Connection. Protocol: ${isHttp2 ? "HTTP/2 (gRPC)" : "HTTP/1.1 (MCP)"}`,
				);
				if (isHttp2) {
					this.h2Server.emit("connection", socket);
				} else {
					this.h1Server.emit("connection", socket);
				}
				socket.unshift(buffer);
			});
			socket.on("error", (err) =>
				log.error(`[LIOP-Gateway] NetServer Socket Error: ${err.message}`),
			);
		});

		// Attach error listeners to sub-servers to catch silent failures
		this.h1Server.on("error", (err) =>
			log.error(`[LIOP-Gateway] H1 Server Error: ${err.message}`),
		);
		this.h2Server.on("error", (err) =>
			log.error(`[LIOP-Gateway] H2 Server Error: ${err.message}`),
		);

		log.info("[LIOP-Gateway] Hybrid adapter initialized.");
	}

	private setupH2Routes() {
		this.h2Server.on("stream", (stream, headers) => {
			const contentType = headers["content-type"] as string;
			const path = headers[":path"] as string;

			if (contentType === "application/grpc") {
				this.handleGrpcStream(stream as http2.ServerHttp2Stream);
			} else if (path === "/mcp") {
				this.handleMcpH2Stream(stream as http2.ServerHttp2Stream, headers);
			}
		});
	}

	private setupH1Routes() {
		this.h1Server.on("request", async (req, res) => {
			this.activeRequests += 1;
			const onDone = () => {
				res.removeListener("finish", onDone);
				res.removeListener("close", onDone);
				this.activeRequests = Math.max(0, this.activeRequests - 1);
			};
			res.on("finish", onDone);
			res.on("close", onDone);

			const url = req.url || "";
			const method = req.method;

			// [Phase Beta-3] Prometheus Metrics Endpoint
			if (method === "GET" && url === "/metrics") {
				if (this.meshNode) {
					meshPeersConnected.set({}, this.meshNode.getPeers().length);
				}
				if (this.router) {
					manifestCacheSize.set({}, this.router.getManifestCacheSize());
				}
				res.writeHead(200, {
					"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
				});
				res.end(protocolMetrics.exportPrometheusText());
				return;
			}

			// [Phase Beta-3] K8s Liveness Probe
			if (method === "GET" && url === "/healthz") {
				if (this.isDraining) {
					res.writeHead(503, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "draining",
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "ok",
						uptime: Math.floor(process.uptime()),
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			// [Phase Beta-3] K8s Readiness Probe
			if (method === "GET" && url === "/readyz") {
				if (this.isDraining) {
					res.writeHead(503, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "draining",
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				const meshStarted = this.meshNode ? this.meshNode.isStarted() : true;
				if (!meshStarted) {
					res.writeHead(503, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "unready",
							meshStarted: false,
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "ready",
						meshStarted: true,
						peers: this.meshNode ? this.meshNode.getPeers().length : 0,
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			// Reject new MCP requests if draining
			if (this.isDraining && url === "/mcp") {
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: {
							code: -32000,
							message: "Gateway is draining connections for shutdown",
						},
					}),
				);
				return;
			}

			// [Phase Beta-2] gRPC-Web HTTP/1.1 Framing Fallback
			const contentType = req.headers["content-type"];
			if (isGrpcWebRequest(contentType)) {
				await dispatchGrpcWebRequest(req, res, async (reqPath, payload) => {
					log.info(
						`[LIOP-Gateway] gRPC-Web fallback call: ${reqPath} (${payload.length} bytes)`,
					);
					return {
						status: GRPC_WEB_CONSTANTS.STATUS_OK,
						message: "OK",
						data: Buffer.from(""),
					};
				});
				return;
			}

			// [SEC] M2M OAuth 2.1 OIDC Authorization Server Router (Phase C proxy)
			if (url.startsWith("/oidc") && this.oauthProvider) {
				const callback =
					typeof this.oauthProvider.callback === "function"
						? this.oauthProvider.callback()
						: this.oauthProvider;
				// Rewrite req.url to strip the '/oidc' prefix before delegating to oidc-provider
				const originalUrl = req.url;
				req.url = (originalUrl || "").slice(5) || "/";
				try {
					return callback(req, res);
				} finally {
					req.url = originalUrl;
				}
			}

			// [SEC] RFC 9728 Protected Resource Metadata (PRM) Endpoint
			if (method === "GET" && url === "/.well-known/oauth-protected-resource") {
				if (this.jwtValidator) {
					const prm = buildProtectedResourceMetadata(
						this.jwtValidator.getIssuer(),
						this.jwtValidator.getAudience(),
					);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(prm));
					return;
				}
				res.writeHead(404);
				res.end("Not Found");
				return;
			}

			if (
				method === "GET" &&
				(url === "/" || url === "/mcp" || url === "/health")
			) {
				if (
					url === "/health" &&
					req.headers.accept?.includes("application/json")
				) {
					const meshInfo = this.meshNode
						? {
								peerId: this.meshNode.getPeerId()?.toString() || "",
								multiaddrs: this.meshNode
									.getMultiaddrs()
									.map((m) => m.toString()),
							}
						: null;
					const issuer = this.jwtValidator?.getIssuer();
					const baseUrl = issuer
						? issuer.endsWith("/oidc")
							? issuer
							: `${issuer}/oidc`
						: "";
					const authInfoResponse =
						this.jwtValidator && issuer
							? {
									issuer,
									jwks_uri: `${baseUrl}/jwks`,
									...(this.oauthProvider
										? {
												token_endpoint: `${baseUrl}/token`,
											}
										: {}),
								}
							: undefined;

					const topologyInfo = {
						tier: this.meshNode?.isPrivateNetwork?.() ? 1 : 2,
						prmEndpoint: this.jwtValidator
							? "/.well-known/oauth-protected-resource"
							: undefined,
						transportCapabilities: ["http-mcp", "grpc-lio", "p2p-dht"],
					};

					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "healthy",
							node: this.liopServer.getServerInfo(),
							mesh: meshInfo,
							tools: this.liopServer.listTools().map((t) => t.name),
							auth: authInfoResponse,
							topology: topologyInfo,
							timestamp: new Date().toISOString(),
						}),
					);
					return;
				}

				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
                    <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
                        <div style="background:#1e293b;padding:40px;border-radius:16px;border:1px solid #38bdf8;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1)">
                            <h1 style="color:#38bdf8;margin-top:0">LIOP Protocol Transformer</h1>
                            <p style="opacity:0.8;font-weight:600">L4/L7 Transcoding: JSON-RPC &harr; gRPC</p>
                            <p style="opacity:0.6;font-size:14px">Active Protections: Kyber768 + AES-256-GCM + ZK-Proof Ready</p>
                            <div style="background:#0f172a;padding:15px;border-radius:8px;margin-top:20px;border:1px dashed #334155">
                                <code style="color:#10b981">Endpoint: http://localhost:3000/mcp</code>
                            </div>
                        </div>
                    </body>
                `);
				return;
			}

			if (url === "/mcp" && method === "POST") {
				let authInfo: AuthInfo | null = null;

				// [SEC] Continuous verification of Bearer token (NIST SP 800-207)
				if (this.jwtValidator) {
					const authHeader = req.headers.authorization;
					if (!authHeader?.startsWith("Bearer ")) {
						res.writeHead(401, {
							"WWW-Authenticate":
								'Bearer error="invalid_token", error_description="Missing or malformed Authorization header"',
							"Content-Type": "application/json",
						});
						res.end(JSON.stringify({ error: "Unauthorized" }));
						return;
					}
					try {
						authInfo = await this.jwtValidator.validate(authHeader.slice(7));
					} catch (e: unknown) {
						res.writeHead(401, {
							"WWW-Authenticate": `Bearer error="invalid_token", error_description="${(e as Error).message}"`,
							"Content-Type": "application/json",
						});
						res.end(JSON.stringify({ error: "Invalid token" }));
						return;
					}
				}

				let body = "";
				req.on("data", (chunk) => (body += chunk.toString()));
				req.on("end", async () => {
					// [SEC] Rate limiting per IP or authenticated client (OWASP API4:2023)
					const clientIp = req.socket.remoteAddress || "127.0.0.1";
					const rateLimitKey = authInfo?.clientId
						? `client:${authInfo.clientId}`
						: `ip:${clientIp}`;
					const rateStatus = this.rateLimiter.check(rateLimitKey);
					if (!rateStatus.allowed) {
						res.writeHead(429, {
							"Content-Type": "application/json",
							"Retry-After": Math.ceil(rateStatus.resetMs / 1000).toString(),
						});
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								id: null,
								error: {
									code: -32029,
									message: "Rate limit exceeded. Too many requests.",
								},
							}),
						);
						return;
					}

					try {
						const jsonRequest = JSON.parse(body);

						// [SEP-2243] Header-based routing validation
						const mcpMethod = req.headers["mcp-method"] as string | undefined;
						const mcpName = req.headers["mcp-name"] as string | undefined;
						const mcpVersion = req.headers["mcp-protocol-version"] as
							| string
							| undefined;

						if (mcpMethod && mcpMethod !== jsonRequest.method) {
							res.writeHead(400, { "Content-Type": "application/json" });
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									id: jsonRequest.id ?? null,
									error: {
										code: -32020,
										message: `HeaderMismatch: 'Mcp-Method' header (${mcpMethod}) does not match JSON-RPC method (${jsonRequest.method})`,
									},
								}),
							);
							return;
						}

						if (
							mcpName &&
							jsonRequest.params?.name &&
							mcpName !== jsonRequest.params.name
						) {
							res.writeHead(400, { "Content-Type": "application/json" });
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									id: jsonRequest.id ?? null,
									error: {
										code: -32020,
										message: `HeaderMismatch: 'Mcp-Name' header (${mcpName}) does not match target name (${jsonRequest.params.name})`,
									},
								}),
							);
							return;
						}

						if (mcpVersion && jsonRequest.params) {
							if (!jsonRequest.params._meta) {
								jsonRequest.params._meta = {};
							}
							if (
								!jsonRequest.params._meta[
									"io.modelcontextprotocol/protocolVersion"
								]
							) {
								jsonRequest.params._meta[
									"io.modelcontextprotocol/protocolVersion"
								] = mcpVersion;
							}
						}

						const response = await this.router.dispatch(jsonRequest, authInfo);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(response));
					} catch (e: unknown) {
						log.info(
							`[LIOP-Gateway] Error processing JSON-RPC payload: ${(e as Error).message}`,
						);
						res.writeHead(400);
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								error: { code: -32700, message: "Parse error" },
							}),
						);
					}
				});
			} else {
				res.writeHead(404);
				res.end("Not Found");
			}
		});
	}

	private handleGrpcStream(stream: http2.ServerHttp2Stream) {
		stream.on("data", (chunk: unknown) => {
			// biome-ignore lint/suspicious/noExplicitAny: Standard gRPC stream data is Buffer
			const data = chunk as any;
			if (data)
				log.info(
					`[LIOP-Gateway] Native gRPC Proxy passing ${data.length} bytes`,
				);
		});
		stream.respond({ ":status": 200, "content-type": "application/grpc" });
		stream.end();
	}

	private handleMcpH2Stream(
		stream: http2.ServerHttp2Stream,
		headers: http2.IncomingHttpHeaders,
	) {
		let body = "";
		stream.on("data", (chunk) => (body += chunk.toString()));
		stream.on("end", async () => {
			try {
				let authInfo: AuthInfo | null = null;

				// [SEC] Continuous verification of Bearer token over HTTP/2 (NIST SP 800-207)
				if (this.jwtValidator) {
					const authHeader = headers.authorization as string;
					if (!authHeader?.startsWith("Bearer ")) {
						stream.respond({
							":status": 401,
							"www-authenticate":
								'Bearer error="invalid_token", error_description="Missing or malformed Authorization header"',
							"content-type": "application/json",
						});
						stream.end(JSON.stringify({ error: "Unauthorized" }));
						return;
					}
					try {
						authInfo = await this.jwtValidator.validate(authHeader.slice(7));
					} catch (e: unknown) {
						stream.respond({
							":status": 401,
							"www-authenticate": `Bearer error="invalid_token", error_description="${(e as Error).message}"`,
							"content-type": "application/json",
						});
						stream.end(JSON.stringify({ error: "Invalid token" }));
						return;
					}
				}

				const jsonRequest = JSON.parse(body);

				// [SEP-2243] Header-based routing validation in HTTP/2
				const mcpMethod = headers["mcp-method"] as string | undefined;
				const mcpName = headers["mcp-name"] as string | undefined;
				const mcpVersion = headers["mcp-protocol-version"] as
					| string
					| undefined;

				if (mcpMethod && mcpMethod !== jsonRequest.method) {
					stream.respond({
						":status": 400,
						"content-type": "application/json",
					});
					stream.end(
						JSON.stringify({
							jsonrpc: "2.0",
							id: jsonRequest.id ?? null,
							error: {
								code: -32020,
								message: `HeaderMismatch: 'Mcp-Method' header (${mcpMethod}) does not match JSON-RPC method (${jsonRequest.method})`,
							},
						}),
					);
					return;
				}

				if (
					mcpName &&
					jsonRequest.params?.name &&
					mcpName !== jsonRequest.params.name
				) {
					stream.respond({
						":status": 400,
						"content-type": "application/json",
					});
					stream.end(
						JSON.stringify({
							jsonrpc: "2.0",
							id: jsonRequest.id ?? null,
							error: {
								code: -32020,
								message: `HeaderMismatch: 'Mcp-Name' header (${mcpName}) does not match target name (${jsonRequest.params.name})`,
							},
						}),
					);
					return;
				}

				if (mcpVersion && jsonRequest.params) {
					if (!jsonRequest.params._meta) {
						jsonRequest.params._meta = {};
					}
					if (
						!jsonRequest.params._meta["io.modelcontextprotocol/protocolVersion"]
					) {
						jsonRequest.params._meta[
							"io.modelcontextprotocol/protocolVersion"
						] = mcpVersion;
					}
				}

				const response = await this.router.dispatch(jsonRequest, authInfo);
				if (response) {
					stream.respond({
						":status": 200,
						"content-type": "application/json",
					});
					stream.end(JSON.stringify(response));
				} else stream.close();
			} catch (_e) {
				stream.respond({ ":status": 400 });
				stream.end();
			}
		});
	}

	public async listen(port: number, host: string = "0.0.0.0"): Promise<number> {
		if (this.meshNode) {
			await this.meshNode.start();

			// Announce all local tools to the DHT
			const tools = this.liopServer.listTools();
			for (const tool of tools) {
				await this.meshNode.announceCapability(tool.name);
				log.info(
					`[LIOP-Gateway] 📡 Announced local tool to Mesh: ${tool.name}`,
				);
			}
		}
		return new Promise((resolve, reject) => {
			this.netServer.on("error", (err: Error & { code?: string }) => {
				if (err.code === "EADDRINUSE") {
					log.info(
						`[LIOP-Gateway] FATAL: Port ${port} is already in use by another process.`,
					);
				} else {
					log.error(`[LIOP-Gateway] Binding Error: ${err.message}`);
				}
				reject(err);
			});

			this.netServer.listen(port, host, () => {
				const addr = this.netServer.address();
				const actualHost =
					typeof addr === "string" ? addr : addr?.address || host;
				const assignedPort =
					typeof addr === "string" ? port : addr?.port || port;

				log.info(
					`[LIOP-Gateway] ✅ Transformer Mesh Gateway READY and listening on ${actualHost}:${assignedPort}`,
				);
				resolve(assignedPort);
			});
		});
	}

	public isDrained(): boolean {
		return this.isDraining;
	}

	public async drain(timeoutMs = 5000): Promise<void> {
		this.isDraining = true;
		log.info(
			`[LIOP-Gateway] Draining gateway connections (active: ${this.activeRequests}, timeout: ${timeoutMs}ms)...`,
		);
		const start = Date.now();
		while (this.activeRequests > 0 && Date.now() - start < timeoutMs) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		await this.stop();
	}

	public async stop() {
		if (this.meshNode) {
			await this.meshNode.stop();
		}
		this.rateLimiter.close();
		this.netServer.close();
		this.h2Server.close();
		this.h1Server.close();
	}

	public getRouter(): LiopMcpRouter {
		return this.router;
	}
}
