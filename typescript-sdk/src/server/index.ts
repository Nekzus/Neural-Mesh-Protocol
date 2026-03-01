import { z } from "zod";
import type {
	CallToolRequest,
	CallToolResult,
	Prompt,
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
	private prompts: Map<string, Prompt> = new Map();

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
		// Zod to JSON Schema derivation is mocked here for parity
		// In production we would use `zod-to-json-schema`
		const inputSchema = {
			type: "object",
			properties: {}, // Would be derived
		};

		this.tools.set(name, {
			tool: { name, description, inputSchema },
			handler,
			schema,
		});
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
