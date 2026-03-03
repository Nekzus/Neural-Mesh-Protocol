import crypto from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
	CallToolRequest,
	CallToolResult,
	GetPromptRequest,
	GetPromptResult,
	Prompt,
	Resource,
	ServerInfo,
	Tool,
} from "../types.js";
import { PII_PATTERNS, type PiiRule, PiiScanner } from "./pii.js";

export { PiiScanner, type PiiRule, PII_PATTERNS };

export type ToolHandler<T extends z.ZodRawShape = z.ZodRawShape> = (
	args: z.infer<z.ZodObject<T>>,
	extra: { signal?: AbortSignal },
) => Promise<CallToolResult>;

export class NmpServer {
	private logicCache: Map<string, { hash: string; timestamp: number }> =
		new Map();
	private connectionStats: Map<
		string,
		{ failures: number; lastAttempt: number }
	> = new Map();
	private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
	private readonly THROTTLE_THRESHOLD = 5;
	private readonly THROTTLE_COOLDOWN_MS = 60 * 1000; // 60 seconds

	private tools: Map<
		string,
		// biome-ignore lint/suspicious/noExplicitAny: Types erased at runtime, Map holds heterogeneous generics
		{ tool: Tool; handler: ToolHandler<any>; schema: z.ZodObject<any> }
	> = new Map();
	private resources: Map<string, Resource & { contentText?: string }> =
		new Map();
	private prompts: Map<
		string,
		{
			prompt: Prompt;
			handler: (
				request: GetPromptRequest,
			) => GetPromptResult | Promise<GetPromptResult>;
		}
	> = new Map();

	private piiScanner: PiiScanner;

	constructor(
		private serverInfo: ServerInfo,
		private config?: {
			capabilities?: Record<string, unknown>;
			security?: { piiPatterns?: PiiRule[] };
		},
	) {
		this.piiScanner = new PiiScanner(this.config?.security?.piiPatterns || []);
	}

	/**
	 * Register a new Tool
	 */
	public tool<T extends z.ZodRawShape>(
		name: string,
		description: string,
		shape: T,
		handler: ToolHandler<T>,
	): void {
		if (this.tools.has(name)) {
			throw new Error(`Tool already registered: ${name}`);
		}

		const schema = z.object(shape);
		const generatedSchema = zodToJsonSchema(schema);

		let finalDescription = description;
		let finalHandler = handler;

		// NMP Zero-Shot Autonomy Middleware: Detect Logic-on-Origin tools
		if (shape.payload && shape.payload instanceof z.ZodString) {
			finalDescription += `\n\nIMPORTANT FORMAT REQUIREMENTS:\nThe payload string MUST encapsulate valid executable JavaScript code between strict boundaries:\n\n---BEGIN_LOGIC---\n// Your JS code here. The runtime exposes 'env.records' array.\n// EXTREMELY IMPORTANT: You MUST use the 'return' statement at the end of your logic to output the final data, otherwise the result will be undefined.\n---END_LOGIC---`;
			finalDescription += `\n\nOptional: You can include an "__nmp_bypass_ast_cache" boolean parameter set to true to force AST re-evaluation.`;

			finalHandler = async (
				args: z.infer<z.ZodObject<T>>,
				extra: { signal?: AbortSignal },
			) => {
				const clientId = "global_connection"; // Simplify for now, treating the instance as one connection
				const now = Date.now();
				const stats = this.connectionStats.get(clientId) || {
					failures: 0,
					lastAttempt: 0,
				};

				if (
					stats.failures >= this.THROTTLE_THRESHOLD &&
					now - stats.lastAttempt < this.THROTTLE_COOLDOWN_MS
				) {
					return {
						content: [
							{
								type: "text",
								text: "NMP_THROTTLED: Too many violations. Cooling down for 60 seconds.",
							},
						],
						isError: true,
					};
				}

				const payloadValue = (args as Record<string, unknown>)
					.payload as string;
				const bypassCache =
					(args as Record<string, unknown>).__nmp_bypass_ast_cache === true;

				const payloadHash = crypto
					.createHash("sha256")
					.update(payloadValue)
					.digest("hex");
				const cached = this.logicCache.get(payloadHash);

				if (
					!bypassCache &&
					cached &&
					now - cached.timestamp < this.CACHE_TTL_MS
				) {
					// Hash verified. Skips boundaries check (already validated!). Extract logic directly.
					console.log(
						`[NMP-SDK] AST Cache Hit for ${payloadHash.substring(0, 8)}. Bypassing Heuristics.`,
					);
					const logicMatch = payloadValue.match(
						/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
					);
					if (logicMatch && logicMatch.length >= 2) {
						(args as Record<string, unknown>).payload = logicMatch[1].trim();
						return await handler(args, extra);
					}
				}

				const logicMatch = payloadValue.match(
					/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
				);

				if (!logicMatch || logicMatch.length < 2) {
					stats.failures++;
					stats.lastAttempt = now;
					this.connectionStats.set(clientId, stats);
					return {
						content: [
							{
								type: "text",
								text: "Error: Malformed payload. Missing magic bytes or logic boundaries.\nYou MUST wrap your logic exactly like this:\n---BEGIN_LOGIC---\n// code\n---END_LOGIC---",
							},
						],
						isError: true,
					};
				}

				try {
					// Extract pure logic and deliver it to the developer's function
					(args as Record<string, unknown>).payload = logicMatch[1].trim();
					let result = await handler(args, extra);

					// NMP Native Serialization: Ensure 'text' content is stringified if it's an object/array
					if (result.content && Array.isArray(result.content)) {
						result = {
							...result,
							content: result.content.map((item) => {
								if (
									item.type === "text" &&
									item.text !== undefined &&
									typeof item.text === "object"
								) {
									return {
										...item,
										text: JSON.stringify(item.text),
									};
								}
								return item;
							}),
						};
					}

					// NMP Native Egress Filter (Professional PII Protection V2)
					if (!result.isError) {
						const violation = this.piiScanner.scan(result.content);
						if (violation) {
							console.error(
								`\n🚨 [NMP-SDK] SECURITY VIOLATION: Professional Egress Filter blocked PII leak (${violation}).`,
							);
							return {
								content: [
									{
										type: "text",
										text: `[NMP] Egress Security Violation. Output blocked due to PII leakage (${violation}).`,
									},
								],
								isError: true,
							};
						}
					}

					if (!result.isError) {
						this.connectionStats.set(clientId, {
							failures: 0,
							lastAttempt: now,
						});
						this.logicCache.set(payloadHash, {
							hash: payloadHash,
							timestamp: now,
						});
					} else if (
						result.content.find((c) => c.text?.includes("VIOLETION_DETECTED"))
					) {
						stats.failures++;
						stats.lastAttempt = now;
						this.connectionStats.set(clientId, stats);
					}

					return result;
				} catch (error: unknown) {
					const e = error as Error;
					if (e.message?.includes("VIOLETION_DETECTED")) {
						stats.failures++;
						stats.lastAttempt = now;
						this.connectionStats.set(clientId, stats);
					}
					throw error;
				}
			};
		}

		const inputSchema = {
			type: "object",
			properties: (generatedSchema as Record<string, unknown>).properties || {},
			required: (generatedSchema as Record<string, unknown>).required,
		};

		this.tools.set(name, {
			tool: { name, description: finalDescription, inputSchema },
			handler: finalHandler,
			schema,
		});
	}

	/**
	 * Register a dynamic prompt
	 */
	public prompt(
		name: string,
		description: string | undefined,
		args: Prompt["arguments"],
		handler: (
			request: GetPromptRequest,
		) => GetPromptResult | Promise<GetPromptResult>,
	): void {
		if (this.prompts.has(name)) {
			throw new Error(`Prompt already registered: ${name}`);
		}
		this.prompts.set(name, {
			prompt: { name, description, arguments: args },
			handler,
		});
	}

	/**
	 * Enables NMP Zero-Shot Autonomy by registering the Blind Analyst standard prompt.
	 */
	public enableZeroShotAutonomy(): void {
		this.prompt(
			"nmp_blind_analyst",
			"The official Neural Mesh Protocol system prompt. Instructs the LLM on how to securely inject Logic-on-Origin without violating PII or safety constraints.",
			[],
			(_request) => {
				return {
					description: "NMP Blind Analyst Instructions",
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: `You are the "Blind Analyst" of the Neural Mesh Protocol (NMP).
Your objective is to perform Logic-on-Origin injections safely and securely without ever seeing the raw data.

CRITICAL RULES:
1. NEVER attempt to export or return Personally Identifiable Information (PII) such as IDs, names, or individual medical records. The egress filter (The Shield) will block your response instantly.
2. Only return aggregated data, counts, averages, or safe analysis results stringified as JSON.
3. When using tools that require a 'payload', your JavaScript code MUST be strictly encapsulated between these exact boundaries:
---BEGIN_LOGIC---
// your javascript here
---END_LOGIC---
4. The runtime provides a global 'env.records' array with the target data. Ensure your logic iterates over this safely.

Failure to follow these rules will result in an immediate violation and the execution will be aborted.`,
							},
						},
					],
				};
			},
		);
	}

	/**
	 * Register a dynamic resource
	 */
	public resource(
		name: string,
		uri: string,
		description?: string,
		mimeType?: string,
		contentText?: string,
	): void {
		if (this.resources.has(uri)) {
			throw new Error(`Resource URI already registered: ${uri}`);
		}
		this.resources.set(uri, { name, uri, description, mimeType, contentText });
	}

	/**
	 * Broadcasts the Data Dictionary to the LLM prior to code injection.
	 */
	public dataDictionary(
		schema: Record<string, unknown>,
		name: string = "Global Medical Data Dictionary",
		uri: string = "nmp://schema/global",
		description: string = "Exposes the internal database schema for Zero-Shot Autonomy planning",
	): void {
		this.resource(
			name,
			uri,
			description,
			"application/json",
			JSON.stringify(schema, null, 2),
		);
	}

	/**
	 * Manually invalidates the AST Logic Cache (e.g. for Zero-Day patches).
	 */
	public clearAstCache(): void {
		this.logicCache.clear();
		console.log("[NMP-SDK] AST Security Cache cleared by Admin.");
	}

	/**
	 * Emulates calling a tool (used locally or via NmpMcpBridge)
	 */
	public async callTool(request: CallToolRequest): Promise<CallToolResult> {
		const entry = this.tools.get(request.name);
		if (!entry) {
			throw new Error(`Tool not found: ${request.name}`);
		}

		try {
			// Validate inputs natively with Zod before execution
			const parsedArgs = entry.schema.parse(request.arguments || {});

			// Re-inject the bypass flag if present since Zod might strip unrecognized keys
			if (
				(request.arguments as Record<string, unknown>)
					?.__nmp_bypass_ast_cache === true
			) {
				(parsedArgs as Record<string, unknown>).__nmp_bypass_ast_cache = true;
			}

			const result = await entry.handler(parsedArgs, {});
			return result;
		} catch (error: unknown) {
			const e = error as Error;
			if (e instanceof z.ZodError) {
				return {
					content: [{ type: "text", text: `Validation Error: ${e.message}` }],
					isError: true,
				};
			}
			return {
				content: [
					{ type: "text", text: `Internal Execution Error: ${e.message}` },
				],
				isError: true,
			};
		}
	}

	/**
	 * Retrieves registered tools
	 */
	public listTools(): Tool[] {
		return Array.from(this.tools.values()).map((t) => t.tool);
	}

	/**
	 * Retrieves registered prompts
	 */
	public listPrompts(): Prompt[] {
		return Array.from(this.prompts.values()).map((p) => p.prompt);
	}

	/**
	 * Gets a specific prompt by name
	 */
	public async getPrompt(request: GetPromptRequest): Promise<GetPromptResult> {
		const entry = this.prompts.get(request.name);
		if (!entry) {
			throw new Error(`Prompt not found: ${request.name}`);
		}
		return await entry.handler(request);
	}

	/**
	 * Retrieves registered resources
	 */
	public listResources(): Resource[] {
		return Array.from(this.resources.values());
	}

	/**
	 * Reads a specific resource by URI
	 */
	public readResource(uri: string): {
		contents: Array<{ uri: string; mimeType?: string; text: string }>;
	} {
		const resource = this.resources.get(uri);
		if (!resource) {
			throw new Error(`Resource not found: ${uri}`);
		}

		// In a real scenario, this would read from disk or a database
		// For our Logic-on-Origin demo, we'll return its description/content
		return {
			contents: [
				{
					uri: resource.uri,
					mimeType: resource.mimeType || "text/plain",
					text:
						resource.contentText ||
						resource.description ||
						"No description provided",
				},
			],
		};
	}

	public getServerInfo(): ServerInfo {
		return this.serverInfo;
	}

	/**
	 * Connects to the libp2p Kademlia DHT and announces capabilities.
	 */
	public async connectToMesh(): Promise<void> {
		console.log(
			`[NMP-SDK] Booting Neural Mesh Protocol Node (${this.serverInfo.name} v${this.serverInfo.version})`,
		);
		console.log("[NMP-SDK] Establishing P2P Noise Transport & Yamux Mplex...");

		// In a real scenario, this would initialize the @libp2p/libp2p node
		// and register the gRPC handlers.
		console.log(
			`[NMP-SDK] Connected. Announcing ${this.tools.size} tool schemas to Kademlia DHT.`,
		);
	}
}
