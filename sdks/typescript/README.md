<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730727/Neural-Mesh-Protocol/bxasdalv9vwyt7m45vnb.svg">
    <img alt="Neural Mesh Protocol Logo" src="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730741/Neural-Mesh-Protocol/koych4jotjoldgo4ydpk.svg" width="700">
  </picture>
</div>

# Neural Mesh Protocol (NMP) - TypeScript SDK

The `@nekzus/neural-mesh` is the official TypeScript tooling interface designed to bring NMP logic-on-origin and peer-to-peer context extraction seamlessly to Node.js environments.

**Design Goal:** Be a trivial, drop-in replacement for Anthropic's Model Context Protocol (MCP) APIs.

## Why this SDK?

This SDK bridges the gap between the complex decentralized mesh (Kademlia/gRPC/WASM) and the elegant developer experience defined by modern AI frameworks. 

Through the `NmpServer` and `NmpMcpBridge` classes, developers can declare tools and resources exactly as they used to with standard MCP APIs (`Zod` schemas, text/image blocks). The SDK dynamically intercepts these definitions and injects them into the high-performance binary NMP network.

### Multi-Core Hardware Scaling

Node.js is traditionally bottlenecked by its single-thread V8 Event Loop. This SDK obliterates that limitation. It features a built-in *Zero-Blocking Worker Pool* powered by `piscina`, immediately dispatching extreme algorithmic tasks (Kyber768 Asymmetric Decryption, AES-GCM Authentication, WASM Sandboxing) continuously to parallel Operating System Threads mimicking the unbarred computational scaling previously thought exclusive to Rust.

## Installation

This workspace uses `pnpm` under a strict configuration. It relies on Biome.js for extreme-speed linting and Vitest for rigorous testing.

```bash
# Navigate to the sdk root
cd sdks/typescript

# Install dependencies (Node Modules are strictly git-ignored)
pnpm install

# Build everything
pnpm build
```

## Usage Example

Declaring a node and exposing a tool is as simple as:

```typescript
import { NmpServer } from '@nekzus/neural-mesh';
import { z } from 'zod';

const server = new NmpServer({
  name: "MyDatabaseAgent",
  version: "1.0.0"
});

// NMP will handle the WASM parsing and validation dynamically
server.tool(
  "analyze_logs",
  "Analyzes giant local files without sending them to the LLM.",
  { target_error: z.string() },
  async ({ target_error }) => {
    // Logic runs natively at origin!
    return {
      content: [{ type: "text", text: `Found 51 occurrences of ${target_error}` }]
    };
  }
);

// Expose Data Schemas for Zero-Shot Intelligence
server.resource(
  "nmp://schema/logs",
  "The exact format of the local logs.",
  "application/json",
  JSON.stringify({ type: "object", properties: { target_error: { type: "string" } } })
);

// Advanced Security & Anti-Hallucination (Fase 44/45)
server.dataDictionary({
  id: "string (PII)",
  age: "number",
  condition: "string"
});

const secureServer = new NmpServer(info, {
  security: { forbiddenKeys: ["id", "password"] }
});
```

## Testing & CI

An exhaustive vitest workspace is configured, separated into core unit tests, conformance, and integration tests spanning P2P simulated environments.

```bash
# Run all tests with coverage
pnpm test

# Run the lightning-fast biomer.js linter and formatter
pnpm lint
pnpm format
```

All source paths and dependencies are isolated. Modifying this SDK will not affect the core Rust backend at `../../servers/mesh-node`.
