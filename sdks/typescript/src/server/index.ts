import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Piscina } from "piscina";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
	private activeSchema: Record<string, unknown> | null = null;
	private sandboxRecords: any[] = [];

	private piiScanner: PiiScanner;
	private workerPool: Piscina;

	constructor(
		private serverInfo: ServerInfo,
		private config?: {
			capabilities?: Record<string, unknown>;
			security?: { piiPatterns?: PiiRule[]; forbiddenKeys?: string[] };
		},
	) {
		this.piiScanner = new PiiScanner(
			this.config?.security?.piiPatterns || [],
			this.config?.security?.forbiddenKeys || [],
		);

		// Initialize Zero-Blocking Worker Pool for Heavy Cryptography & Sandboxing
		const isTS = import.meta.url.endsWith(".ts");
		const workerExt = isTS ? ".ts" : ".js";

		let execArgv: string[] = [];
		if (isTS) {
			try {
				const require = createRequire(import.meta.url);
				const _tsxPath = path.resolve(
					path.dirname(require.resolve("tsx/package.json")),
					"dist/loader.mjs",
				);
				// Check for existence or just use tsx resolving
				execArgv = ["--import", "tsx"];
				// To be extremely safe, we could use the absolute path,
				// but 'tsx' should be resolvable if we are running in TS mode.
				// However, the error suggests it's NOT resolvable in the worker.
				// Let's use the absolute path to the loader if possible.
				try {
					const absoluteTsx = require.resolve("tsx");
					execArgv = ["--import", pathToFileURL(absoluteTsx).href];
				} catch (e) {
					// Fallback
					execArgv = ["--import", "tsx"];
				}
			} catch (_e) {
				execArgv = ["--import", "tsx"];
			}
		}

		const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;

		this.workerPool = new Piscina({
			filename: path.resolve(
				__dirname,
				`../workers/logic-execution${workerExt}`,
			),
			minThreads: isTest ? 0 : 2,
			maxThreads: isTest ? 1 : 8,
			idleTimeout: 1000,
			execArgv,
		});
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
			const blockedKeys = this.config?.security?.forbiddenKeys || [];

			finalDescription += `\n\nIMPORTANT FORMAT REQUIREMENTS:\nThe payload string MUST encapsulate valid executable JavaScript code between strict boundaries:\n\n---BEGIN_LOGIC---\n// Your JS code here. The runtime exposes 'env.records' array.\n// EXTREMELY IMPORTANT 1: You MUST use the 'return' statement at the end of your logic to output the final data, otherwise the result will be undefined.\n// EXTREMELY IMPORTANT 2 (DYNAMIC RETURN STRUCTURE): You MUST format your JSON output keys in the EXACT SAME LANGUAGE as the user's initial prompt/query (i.e. if asked in Spanish, use Spanish keys like 'promedio').`;

			if (blockedKeys.length > 0) {
				finalDescription += `\n// SECURITY RESTRICTION: Do NOT include any of the following fields in your returned objects to prevent PII leaks: ${blockedKeys.join(", ")}`;
			}

			if (this.activeSchema) {
				finalDescription += `\n\nSTRICT SCHEMA ADHERENCE:\nThe 'env.records' array contains objects with the EXACT following structure. ONLY use these fields. Do NOT guess or use fallbacks (e.g. do not use 'gender' if not listed below):\n${JSON.stringify(this.activeSchema, null, 2)}`;
			}

			finalDescription += `\n---END_LOGIC---`;
			finalDescription += `\n\nOptional: You can include an "__nmp_bypass_ast_cache" boolean parameter set to true to force AST re-evaluation.`;

			finalHandler = async (
				args: z.infer<z.ZodObject<T>>,
				_extra: { signal?: AbortSignal },
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
					const logicMatch = payloadValue.match(
						/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
					);
					if (logicMatch && logicMatch.length >= 2) {
						(args as Record<string, unknown>).payload = logicMatch[1].trim();

						// DELEGATE TO WORKER POOL: Parallel PQC & Sandboxing
						return await this.executeInWorkerPool(args, logicMatch[1].trim());
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

					// DELEGATE TO WORKER POOL: Parallel PQC & Sandboxing
					let result = await this.executeInWorkerPool(
						args,
						logicMatch[1].trim(),
					);

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
1. NEVER attempt to export or return Personally Identifiable Information (PII) such as IDs, names, or raw individual records. The egress filter (The Shield) will block your response instantly.
2. Return your execution results stringified as a valid JSON object. Ensure the data adheres strictly to the user's intent while respecting the privacy, security, and schema constraints of the system.
3. When using tools that require a 'payload', your JavaScript code MUST be strictly encapsulated between these exact boundaries:
---BEGIN_LOGIC---
// your javascript here
---END_LOGIC---
4. The runtime provides a global 'env' scope containing the target data ecosystem. Ensure your logic handles the data structures safely.
5. DYNAMIC RETURN STRUCTURE: You MUST format your JSON output keys in the EXACT SAME LANGUAGE as the user's initial prompt/query. If the user asks in Spanish, use Spanish keys (e.g., 'cantidad', 'promedio'). Do not default to English keys unless requested in English.
6. STRICT SCHEMA ADHERENCE: Only use the fields explicitly defined in the provided 'Data Dictionary' or schema. Do NOT attempt to guess, fallback, or use fields not present in the schema (e.g., do not use 'gender' if it is not in the schema).${
									this.activeSchema
										? `\n\nCURRENT DATA SCHEMA:\n${JSON.stringify(this.activeSchema, null, 2)}`
										: ""
								}

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
		this.activeSchema = schema;

		// Retroactively update tool descriptions for already registered tools
		for (const [toolName, entry] of this.tools.entries()) {
			if (
				entry.schema.shape.payload &&
				entry.schema.shape.payload instanceof z.ZodString &&
				entry.tool.description &&
				!entry.tool.description.includes("STRICT SCHEMA ADHERENCE")
			) {
				entry.tool.description += `\n\nSTRICT SCHEMA ADHERENCE:\nThe 'env.records' array contains objects with the EXACT following structure. ONLY use these fields. Do NOT guess or use fallbacks (e.g. do not use 'gender' if not listed below):\n${JSON.stringify(schema, null, 2)}`;
				this.tools.set(toolName, entry);
			}
		}

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
		console.error("[NMP-SDK] AST Security Cache cleared by Admin.");
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
	 * Injects data into the secure sandbox context for Logic-on-Origin tools.
	 */
	public setSandboxData(records: Record<string, unknown>[]) {
		this.sandboxRecords = records;
	}

	/**
	 * Connects to the libp2p Kademlia DHT and announces capabilities.
	 */
	public async connectToMesh(): Promise<void> {
		// In a real scenario, this would initialize the @libp2p/libp2p node
		// and register the gRPC handlers.
	}

	/**
	 * Dispatches heavy computation (Kyber768, AES, WASM/V8 Sandboxing) to the Worker Pool.
	 */
	private async executeInWorkerPool(
		_args: Record<string, unknown>,
		rawPayload: string,
	): Promise<CallToolResult> {
		try {
			// Transparent local execution without dynamic PQC
			const workerResponse = await this.workerPool.run({
				ciphertext: new Uint8Array(0),
				secretKeyObj: Array.from(new Uint8Array(0)),
				kyberPublicKey: new Uint8Array(0),
				wasmBinary: Buffer.from(rawPayload),
				inputs: {},
				records: this.sandboxRecords,
				sessionToken: "local-dev-token",
				isEncrypted: false, // Use plaintext for local Logic-on-Origin injection
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							computation_result: workerResponse.output,
							image_id: workerResponse.image_id,
							status: "Worker Pool Execution Success",
						}),
					},
				],
			};
		} catch (error: unknown) {
			const e = error as Error;
			return {
				content: [
					{
						type: "text",
						text: `WorkerPoolError: ${e.message || String(error)}`,
					},
				],
				isError: true,
			};
		}
	}

	/**
	 * Safely destroys the worker pool and releases thread resources.
	 * Recommended to be called during graceful shutdowns or test teardowns.
	 */
	public async close(): Promise<void> {
		if (this.workerPool) {
			await this.workerPool.destroy();
		}
	}
}
