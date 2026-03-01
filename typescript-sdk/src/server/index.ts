import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
	CallToolRequest,
	CallToolResult,
	Prompt,
	GetPromptRequest,
	GetPromptResult,
	Resource,
	ServerInfo,
	Tool,
} from "../types.js";

export type ToolHandler<T extends z.ZodRawShape = z.ZodRawShape> = (
	args: z.infer<z.ZodObject<T>>,
	extra: { signal?: AbortSignal },
) => Promise<CallToolResult>;

export class NmpServer {
	private tools: Map<
		string,
		{ tool: Tool; handler: ToolHandler<any>; schema: z.ZodObject<any> }
	> = new Map();
	private resources: Map<string, Resource> = new Map();
	private prompts: Map<
		string,
		{
			prompt: Prompt;
			handler: (
				request: GetPromptRequest,
			) => GetPromptResult | Promise<GetPromptResult>;
		}
	> = new Map();

	constructor(
		private serverInfo: ServerInfo,
		private config?: { capabilities?: Record<string, unknown> },
	) { }

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
			finalDescription += `\n\nIMPORTANT FORMAT REQUIREMENTS:\nThe payload string MUST encapsulate valid executable JavaScript code between strict boundaries:\n\n---BEGIN_LOGIC---\n// Your JS code here. The runtime exposes 'env.records' array.\n---END_LOGIC---`;

			finalHandler = async (args: any, extra: any) => {
				const payloadValue = args.payload as string;
				const logicMatch = payloadValue.match(
					/---BEGIN_LOGIC---\n([\s\S]*)\n---END_LOGIC---/,
				);

				if (!logicMatch || logicMatch.length < 2) {
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

				// Extract pure logic and deliver it to the developer's function
				args.payload = logicMatch[1].trim();
				return handler(args, extra);
			};
		}

		const inputSchema = {
			type: "object",
			properties: (generatedSchema as any).properties || {},
			required: (generatedSchema as any).required,
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
			(request) => {
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
	): void {
		if (this.resources.has(uri)) {
			throw new Error(`Resource URI already registered: ${uri}`);
		}
		this.resources.set(uri, { name, uri, description, mimeType });
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
			const result = await entry.handler(parsedArgs, {});
			return result;
		} catch (error: any) {
			if (error instanceof z.ZodError) {
				return {
					content: [
						{ type: "text", text: `Validation Error: ${error.message}` },
					],
					isError: true,
				};
			}
			return {
				content: [
					{ type: "text", text: `Internal Execution Error: ${error.message}` },
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
	public async getPrompt(
		request: GetPromptRequest,
	): Promise<GetPromptResult> {
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
	public readResource(uri: string): { contents: Array<{ uri: string, mimeType?: string, text: string }> } {
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
					text: resource.description || "No description provided",
				}
			]
		}
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
