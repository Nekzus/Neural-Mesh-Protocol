<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730727/Neural-Mesh-Protocol/bxasdalv9vwyt7m45vnb.svg">
    <img alt="Neural Mesh Protocol Logo" src="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730741/Neural-Mesh-Protocol/koych4jotjoldgo4ydpk.svg" width="700">
  </picture>

  <h1>Neural Mesh Protocol (NMP) — TypeScript SDK</h1>

[![Github Workflow](https://github.com/Nekzus/Neural-Mesh-Protocol/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/Nekzus/Neural-Mesh-Protocol/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@nekzus/neural-mesh.svg)](https://www.npmjs.com/package/@nekzus/neural-mesh)
[![npm-month](https://img.shields.io/npm/dm/@nekzus/neural-mesh.svg)](https://www.npmjs.com/package/@nekzus/neural-mesh)
[![npm-total](https://img.shields.io/npm/dt/@nekzus/neural-mesh.svg?style=flat)](https://www.npmjs.com/package/@nekzus/neural-mesh)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-mintlify-0D9373?style=flat)](https://nekzus-32.mintlify.app/)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Nekzus/Neural-Mesh-Protocol)
[![Donate](https://img.shields.io/badge/donate-paypal-blue.svg?style=flat-square)](https://paypal.me/maseortega)


  <p><strong>The official TypeScript SDK for the Neural Mesh Protocol.</strong></p>
  <p>Deploy Logic-on-Origin with WebAssembly sandboxing, gRPC-speed execution, and full MCP backward compatibility.</p>
</div>

---

## Overview

`@nekzus/neural-mesh` is an SDK that implements the **Logic-on-Origin** paradigm: instead of extracting raw data from a server and sending it to an LLM, the LLM injects a micro-module of logic to be executed *at the data source*, inside a secure sandbox. The result — never the raw data — is returned.

This fundamentally solves the data privacy, bandwidth, and latency challenges of AI-powered data analysis at scale.

### Key Capabilities

| Feature | Description |
|:--|:--|
| **Logic-on-Origin** | LLMs send code, not queries. Data never leaves the origin server. |
| **MCP Drop-in Replacement** | `NmpServer` mirrors the Anthropic MCP `Server` API — tools, resources, and prompts with `Zod` schemas. |
| **Guardian AST** | Zero-time heuristic inspection blocks sandbox escapes (`require`, `fs`, `eval`, `fetch`, prototype pollution). |
| **WASI Sandbox** | JavaScript payloads execute inside V8 isolates with CPU fuel limits and no access to Node.js globals. |
| **PII Shield** | Multi-layer egress filter with NIST/OWASP patterns (Email, Credit Card with Luhn, IP, Phone) and configurable forbidden keys. |
| **ZK-Receipts** | Cryptographic proof (SHA-256 + SHA-512 seal) that the returned result was computed honestly from the injected logic. |
| **Worker Pool** | Heavy computation (crypto, sandboxing) dispatched to OS threads via `piscina`, unblocking the V8 event loop. |
| **MCP Bridge** | `NmpMcpBridge` adapts any `NmpServer` to the JSON-RPC 2.0 / stdio protocol used by Claude Desktop, Cursor, etc. |
| **Post-Quantum Ready** | ML-KEM-768 (Kyber) handshake + AES-256-GCM symmetric encryption for transport-layer security. |
| **P2P Mesh** | Kademlia DHT discovery via `libp2p` with TCP + WebSocket + Yamux multiplexing and Noise encryption. |

---

## Installation

```bash
npm install @nekzus/neural-mesh
```

> **Requirements:** Node.js ≥ 20.0. The SDK uses `node:crypto`, `node:vm`, and `piscina` (worker threads) internally.

---

## Quick Start

### 1. Create a Server

```typescript
import { NmpServer, PII_PATTERNS } from "@nekzus/neural-mesh/server";
import { z } from "zod";

const server = new NmpServer(
  { name: "MyDataNode", version: "1.0.0" },
  {
    capabilities: { tools: { listChanged: true } },
    security: {
      // Built-in PII detection (Email, Credit Card, IP, Phone)
      piiPatterns: [PII_PATTERNS.EMAIL, PII_PATTERNS.CREDIT_CARD],
      // Keys that will be stripped from any outgoing response
      forbiddenKeys: ["id", "ssn", "password", "email", "name"],
    },
  }
);
```

### 2. Register a Tool

```typescript
server.tool(
  "analyze_logs",
  "Analyzes local log files without sending raw data to the LLM.",
  { target_error: z.string().describe("The error pattern to search for") },
  async ({ target_error }) => {
    // This logic runs at origin — data never leaves the server
    return {
      content: [{ type: "text", text: `Found 51 occurrences of ${target_error}` }],
    };
  }
);
```

### 3. Connect to Claude Desktop / Cursor (MCP Bridge)

```typescript
import { NmpMcpBridge } from "@nekzus/neural-mesh/bridge";

const bridge = new NmpMcpBridge(server);
await bridge.connect(); // Listens on stdio (JSON-RPC 2.0)
```

**Claude Desktop config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-data-node": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"]
    }
  }
}
```

---

## Module Exports

The package exposes targeted entry points to minimize bundle size:

```typescript
import { NmpServer, PII_PATTERNS } from "@nekzus/neural-mesh/server";
import { NmpMcpBridge }             from "@nekzus/neural-mesh/bridge";
import { NmpClient }                from "@nekzus/neural-mesh/client";
import type { Tool, Resource, Prompt, CallToolRequest, CallToolResult } from "@nekzus/neural-mesh/types";
```

---

## API Reference

### `NmpServer`

The core class for declaring data nodes. API-compatible with Anthropic's MCP `Server`.

#### Constructor

```typescript
new NmpServer(
  serverInfo: { name: string; version: string },
  config?: {
    capabilities?: Record<string, unknown>;
    security?: {
      piiPatterns?: PiiRule[];     // Regex/validator rules for PII detection
      forbiddenKeys?: string[];    // Keys stripped from outgoing responses
    };
  }
)
```

#### Methods

| Method | Signature | Description |
|:--|:--|:--|
| `tool()` | `(name, description, zodSchema, handler)` | Registers a callable tool with Zod input validation. |
| `prompt()` | `(name, description, args, handler)` | Registers a dynamic prompt template. |
| `resource()` | `(name, uri, description?, mimeType?, content?)` | Registers a readable resource. |
| `dataDictionary()` | `(schema, name?, uri?, description?)` | Broadcasts a data schema so LLMs can write accurate Logic-on-Origin code. |
| `setSandboxData()` | `(records: Record[])` | Injects data into the sandbox as `env.records` for Logic-on-Origin tools. |
| `enableZeroShotAutonomy()` | `()` | Registers the "Blind Analyst" prompt for autonomous code generation. |
| `callTool()` | `(request: CallToolRequest)` | Invokes a registered tool (used locally or via MCP Bridge). |
| `listTools()` | `()` | Returns all registered tools. |
| `listPrompts()` | `()` | Returns all registered prompts. |
| `getPrompt()` | `(request: GetPromptRequest)` | Returns a specific prompt by name. |
| `listResources()` | `()` | Returns all registered resources. |
| `readResource()` | `(uri: string)` | Reads a resource by URI. |
| `getServerInfo()` | `()` | Returns the server's name and version. |
| `connectToMesh()` | `()` | Connects to the libp2p Kademlia DHT. |
| `clearAstCache()` | `()` | Invalidates the Guardian AST logic cache. |
| `close()` | `()` | Destroys the worker pool and releases threads. |

### `NmpMcpBridge`

Adapter that connects any `NmpServer` to MCP-compatible clients via JSON-RPC 2.0 over stdio.

```typescript
const bridge = new NmpMcpBridge(server);
await bridge.connect();
```

**Supported JSON-RPC methods:**
- `initialize` — Returns server capabilities and info
- `tools/list` — Lists available tools
- `tools/call` — Calls a tool (with ZK-Receipt verification)
- `resources/list` — Lists available resources
- `resources/read` — Reads a resource
- `prompts/list` — Lists available prompts
- `prompts/get` — Gets a specific prompt

---

## Security Architecture

### The Shield — Multi-Layer Defense

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Guardian AST (Zero-Time Static Analysis)  │
│  Blocks: require, import(), fs, eval, fetch,        │
│  process, global, __proto__, XMLHttpRequest          │
├─────────────────────────────────────────────────────┤
│  Layer 2: WASI Sandbox (V8 Isolate)                 │
│  No Node.js globals • CPU Fuel limits • 3s timeout  │
├─────────────────────────────────────────────────────┤
│  Layer 3: PII Shield (Egress Filter)                │
│  Scans output for Email, SSN, Credit Card, IP       │
│  Strips forbidden keys from response objects        │
├─────────────────────────────────────────────────────┤
│  Layer 4: ZK-Receipt (Integrity Verification)       │
│  SHA-256 ImageID + SHA-512 RISC0-style Seal         │
│  NmpMcpBridge verifies before forwarding to LLM     │
└─────────────────────────────────────────────────────┘
```

### PII Patterns

Built-in patterns with multi-layer verification:

```typescript
import { PII_PATTERNS } from "@nekzus/neural-mesh/server";

// Available patterns:
PII_PATTERNS.EMAIL         // RFC 5322 compliant, excludes @example.com/@test.com
PII_PATTERNS.CREDIT_CARD   // Visa/MC/Amex + Luhn algorithm validation
PII_PATTERNS.IP_ADDRESS    // IPv4 with octet range validation (excludes localhost)
PII_PATTERNS.PHONE         // International phone formats with digit-length validation
```

### Forbidden Keys

The PII Shield automatically strips any key from outgoing responses that matches your configured list:

```typescript
const server = new NmpServer(info, {
  security: {
    forbiddenKeys: ["id", "ssn", "password", "token", "secret", "email", "name"],
  },
});
// Any response containing these keys → instantly blocked with "Egress Security Violation"
```

---

## Logic-on-Origin Flow

The following shows a complete Logic-on-Origin execution cycle (handled internally by the SDK):

```
1. LLM generates JavaScript analysis code wrapped in ---BEGIN_LOGIC--- / ---END_LOGIC--- boundaries
2. NmpServer receives the payload via tools/call (JSON-RPC or direct)
3. Guardian AST inspects for sandbox escapes (zero-time heuristic analysis)
4. Code executes inside a V8 isolate with CPU fuel limits (no Node.js globals)
5. PII Shield scans output for forbidden data and keys
6. ZK-Receipt generated (SHA-256 logic hash + SHA-512 seal)
7. Result + receipt returned to the LLM (raw data never exposed)
```

### Data Dictionary & Zero-Shot Autonomy

The Data Dictionary tells the LLM exactly what fields exist in `env.records`, enabling accurate code generation without seeing the actual data:

```typescript
server.dataDictionary({
  id: "string (Anonymized patient identifier, strictly PII)",
  age: "number (Patient age in years)",
  condition: "string (Healthy, Hypertension, Diabetes Type 1, Diabetes Type 2, Heart Disease, Asthma)",
  riskScore: "number (Float 0.0 to 1.0)",
  lastVisit: "string (ISO 8601 date)",
});

server.enableZeroShotAutonomy(); // Registers the "Blind Analyst" prompt
```

---

## Worker Pool (Multi-Core Scaling)

Node.js is single-threaded. Heavy operations like Kyber768 decryption, AES-GCM authentication, AST validation, and V8 sandbox instantiation would block the event loop in a standard setup.

This SDK dispatches all heavy computation to OS-level threads via [`piscina`](https://github.com/piscinajs/piscina), achieving Rust-like concurrency:

```typescript
// Automatic — no configuration needed
// When a Logic-on-Origin payload is received:
// 1. Main thread receives JSON-RPC request
// 2. Worker thread: AST inspection + PQC decryption + Sandbox execution
// 3. Main thread: Returns result (non-blocking)

// Cleanup on shutdown:
await server.close();
```

---

## Post-Quantum Cryptography

Transport-layer security using ML-KEM-768 (Kyber) for key encapsulation and AES-256-GCM for symmetric encryption:

```typescript
import { NmpClient } from "@nekzus/neural-mesh/client";

const client = new NmpClient();
await client.connect();

// Discover remote tools via Kademlia DHT
const tools = await client.discoverTools();

// Call a tool with PQC-encrypted WASM payload
// Kyber768 key encapsulation + AES-256-GCM happens automatically
const result = await client.callTool(request, wasmPayload, serverPublicKey);

// Verify the ZK-Receipt from the remote server
const isValid = await client.verifyZkReceipt(payload, imageId, receipt);
```

---

## P2P Mesh Network

Decentralized tool discovery via Kademlia DHT:

```typescript
await server.connectToMesh();
// Server is now discoverable on the libp2p network
// Transports: TCP + WebSocket
// Multiplexing: Yamux
// Encryption: Noise Protocol
```

---

## Testing & Quality

This package is continuously tested across multiple platforms and Node.js versions via CI/CD:

- **51+ tests** spanning unit, integration, and conformance suites
- **Multi-OS matrix:** Ubuntu, Windows, macOS
- **Node.js versions:** 22.x, 24.x
- **Code quality:** Enforced by [Biome.js](https://biomejs.dev/) (linting + formatting)

> To run tests locally or contribute, clone the [repository](https://github.com/Nekzus/Neural-Mesh-Protocol) and follow the [Contributing Guide](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/CONTRIBUTING.md).

---

## Related

- [NMP Documentation](https://nekzus-32.mintlify.app/) — Full conceptual and API documentation
- [NMP Specification](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/protocol/SPECIFICATION.md) — Technical specification
- [NMP Manifesto](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/MANIFESTO.md) — Project philosophy
- [Contributing Guide](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/CONTRIBUTING.md) — How to contribute
- [Rust Mesh Node](https://github.com/Nekzus/Neural-Mesh-Protocol/tree/main/sdks/rust) — Native high-performance backend

---

## License

[MIT](https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/LICENSE) © [Nekzus](https://github.com/Nekzus)
