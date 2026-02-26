import { z } from "zod";
export interface ToolDefinition<T extends z.ZodType<any, any>> {
    name: string;
    description: string;
    schema: T;
    handler: (args: z.infer<T>) => Promise<{
        content: Array<{
            type: string;
            text: string;
        }>;
    }>;
}
/**
 * NmpServer is the Drop-in Replacement for McpServer.
 * Syntactically identical to the @modelcontextprotocol/sdk/server/mcp.js class,
 * but instead of wiring JSON-RPC via stdio, it dynamically compiles tools
 * to WASM and announces capabilities over the Libp2p/gRPC mesh.
 */
export declare class NmpServer {
    private serverInfo;
    private config?;
    private tools;
    private meshReady;
    constructor(serverInfo: {
        name: string;
        version: string;
    }, config?: {
        meshPort?: number;
        targetDid?: string;
    } | undefined);
    /**
     * Defines a tool. Exactly the same DX as MCP v1.x.x.
     * Internally, the SDK extracts the AST of the handler and
     * initiates Javy Component Model compilation to webassembly.
     */
    tool<T extends z.ZodType<any, any>>(name: string, description: string, schema: T, handler: (args: z.infer<T>) => Promise<{
        content: Array<{
            type: string;
            text: string;
        }>;
    }>): void;
    /**
     * Connects to the libp2p Kademlia DHT and announces capabilities.
     */
    connectToMesh(): Promise<void>;
    compileAndPush(toolName: string, targetPeerId: string): Promise<void>;
}
