/**
 * Neural Mesh Protocol Official SDK
 * @version 1.0.0-alpha
 * 
 * Exporting the drop-in replacement classes for Model Context Protocol APIs.
 */

export { NmpServer } from "./server.js";
export { NmpMcpBridge } from "./bridge.js";

// Re-export Zod for convenience (parallels standard MCP developer experience)
export { z } from "zod";
