<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730727/Neural-Mesh-Protocol/bxasdalv9vwyt7m45vnb.svg">
    <img alt="Neural Mesh Protocol Logo" src="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730741/Neural-Mesh-Protocol/koych4jotjoldgo4ydpk.svg" width="700">
  </picture>
</div>

# NMP: Neural Mesh Protocol (v1.0-alpha)

NMP (Neural Mesh Protocol) is a next-generation, high-performance binary transport mesh designed for advanced Artificial Intelligence Agent communication. Conceived as a conceptual and technical evolution of existing context protocols (like MCP), NMP radically shifts the paradigm from pulling massive data towards secure **Logic-on-Origin** execution.

## Vision

In the rapid evolution of autonomous agents, transferring gigabytes of raw data to central AI nodes for filtering, parsing, or reasoning is increasingly inefficient, slow, and expensive.

NMP introduces a decentralized, Zero-Trust architectural model where AI agents inject ultra-lightweight, sandboxed execution modules (WebAssembly) directly into the data source. By moving the logic to the data rather than the data to the logic, NMP aims to:

- **Dramatically reduce network latency and bandwidth consumption.**
- **Save millions of tokens** by returning only semantically relevant, cryptographically verified evidence from the origin.
- **Provide Zero-Trust security** natively, ensuring the host is never exposed to arbitrary or unsandboxed agent execution via strict WASI capabilities and Layer 3 Egress Filters.

## Architecture

The project is divided into two distinct, highly isolated modules:

### 1. The NMP Node (`servers/mesh-node/`)
The underlying high-performance mesh network, node infrastructure, DHT Kademlia discovery, and the Wasmtime (WASI) sandboxing environment. This is where the core nodes (Client/Agent and Server/Data Source) operate on the metal.
👉 [Read the Mesh Node Documentation](./servers/mesh-node/README.md)

### 2. The TypeScript SDK (`sdks/typescript/`)
The developer tooling, designed to act as a direct, Zero-Friction drop-in replacement for the current Model Context Protocol (MCP) APIs. It provides interfaces like `NmpServer` and `NmpClient`, Zod validation schemas, and transparent Javy/WASM compilation to connect Node.js environments to the Neural Mesh.
👉 [Read the TypeScript SDK Documentation](./sdks/typescript/README.md)

## Key Technical Pillars

1. **Push-Logic Paradigm:** Execute WASM logic exactly where the data lives.
2. **High-Performance Binary Transport:** Built on Tonic (gRPC) and Protobuf instead of JSON over stdout.
3. **Zero-Trust Sandboxing:** Powered by Wasmtime and WASI Preview 1.
4. **Decentralized Mesh Topology:** Peer-to-peer agent discovery via libp2p.
5. **Persistent Multiplexing:** QUIC transport.
6. **Universal MCP Bridge:** 100% legacy compatibility with standard MCP tools and resources.

---
*Developed as the next evolution in Agentic Data Context.*
