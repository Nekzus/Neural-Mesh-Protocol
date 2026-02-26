/**
 * NmpMcpBridge enables legacy MCP (JSON-RPC) tools
 * to seamlessly operate over the new NMP (gRPC/WASM) Mesh.
 *
 * If a company already has `npm-sentinel` running as an Express app
 * or Cloudflare Worker responding to JSON-RPC over HTTP, NMP Agents
 * can use this bridge to wrap those endpoints instantly without refactoring.
 */
export declare class NmpMcpBridge {
    private server;
    constructor(serverInfo: {
        name: string;
        version: string;
    });
    /**
     * Proxies an existing MCP standard `Client` connection
     * (e.g., SSE or stdio) into the NMP Peer-to-Peer logic injector.
     */
    wrapLegacyMcpRoute(route: string, toolsDef: any[]): Promise<void>;
    connect(): Promise<void>;
}
