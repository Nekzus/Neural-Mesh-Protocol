# Neural Mesh Protocol (NMP) - TypeScript SDK

The `@neural-mesh/sdk` is the official TypeScript tooling interface designed to bring NMP logic-on-origin and peer-to-peer context extraction seamlessly to Node.js environments.

**Design Goal:** Be a trivial, drop-in replacement for Anthropic's Model Context Protocol (MCP) APIs.

## Why this SDK?

This SDK bridges the gap between the complex decentralized mesh (Kademlia/gRPC/WASM) and the elegant developer experience defined by modern AI frameworks. 

Through the `NmpServer` and `NmpMcpBridge` classes, developers can declare tools and resources exactly as they used to with standard MCP APIs (`Zod` schemas, text/image blocks). The SDK dynamically intercepts these definitions and injects them into the high-performance binary NMP network.

## Installation

This workspace uses `pnpm` under a strict configuration. It relies on Biome.js for extreme-speed linting and Vitest for rigorous testing.

```bash
# Navigate to the sdk root
cd typescript-sdk

# Install dependencies (Node Modules are strictly git-ignored)
pnpm install

# Build everything
pnpm build
```

## Usage Example

Declaring a node and exposing a tool is as simple as:

```typescript
import { NmpServer } from '@neural-mesh/sdk';
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

All source paths and dependencies are isolated. Modifying this SDK will not affect the core Rust backend at `../rust-app`.
