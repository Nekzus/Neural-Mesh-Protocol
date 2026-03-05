<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730727/Neural-Mesh-Protocol/bxasdalv9vwyt7m45vnb.svg">
    <img alt="Neural Mesh Protocol Logo" src="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730741/Neural-Mesh-Protocol/koych4jotjoldgo4ydpk.svg" width="700">
  </picture>
<p align="center">
  <a href="https://github.com/Nekzus/Neural-Mesh-Protocol/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Nekzus/Neural-Mesh-Protocol.svg" alt="License"></a>
  <a href="https://nekzus-32.mintlify.app/"><img src="https://img.shields.io/badge/docs-mintlify-0D9373?style=flat" alt="Docs"></a>
  <a href="https://deepwiki.com/Nekzus/Neural-Mesh-Protocol"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
  <a href="https://paypal.me/maseortega"><img src="https://img.shields.io/badge/donate-paypal-blue.svg?style=flat-square" alt="Donate"></a>
</p>

</div>

# Neural Mesh Protocol (NMP)

**NMP** is a next-generation, high-performance binary transport mesh designed for advanced AI Agent communication. It is the conceptual and technical evolution of the Model Context Protocol (MCP), radically shifting the paradigm from **pulling massive data** to secure **Logic-on-Origin** execution.

> Instead of moving terabytes of data to the AI, NMP moves lightweight, sandboxed logic to the data.

## The Problem

In the rapid evolution of autonomous agents, transferring gigabytes of raw data to central AI nodes for filtering, parsing, or reasoning is increasingly inefficient, slow, and expensive. Current protocols force agents to download entire datasets to extract a few relevant insights, wasting bandwidth, tokens, and time.

## The NMP Solution: Logic-on-Origin

NMP introduces a **decentralized, Zero-Trust architectural model** where AI agents inject ultra-lightweight, sandboxed execution modules (WebAssembly) directly into the data source. The data never leaves its origin.

```
AI Agent (LLM/SDK)  ──WASM Payload──>  Data Server (Host)
                                         |
                                    Guardian AST
                                         |
                                    Wasmtime WASI Sandbox
                                         |
                                      ZK Prover
                                         |
AI Agent (LLM/SDK)  <──Result + Proof──  Data Server (Host)
```

**Key benefits:**
- **Dramatically reduces network latency and bandwidth** — only semantically relevant results are returned.
- **Saves millions of tokens** — agents receive cryptographically verified evidence, not raw data.
- **Zero-Trust by default** — injected logic runs inside strict WASI sandboxes with capability-limited access.

## Repository Structure

This is a **polyglot monorepo** organized into clear, isolated modules:

```
Neural-Mesh-Protocol/
├── sdks/
│   ├── typescript/          # @nekzus/neural-mesh (NPM package)
│   └── rust/                # nmp-core & nmp-client (Cargo crates)
├── servers/
│   └── mesh-node/           # nmp-server (Wasmtime + gRPC + libp2p)
├── protocol/
│   ├── proto/               # Protobuf v3 service definitions
│   └── SPECIFICATION.md     # Formal protocol specification
├── examples/
│   ├── demos/               # High-fidelity & educational demos
│   └── wasm-filters/        # Example WASM payloads (filter, watchdog)
├── docs/                    # Mintlify documentation portal
├── tests/                   # E2E integration tests
├── MANIFESTO.md             # Project philosophy & vision
├── CONTRIBUTING.md          # Contribution guide (EN/ES)
├── CODE_OF_CONDUCT.md       # Code of conduct (EN/ES)
└── Cargo.toml               # Rust workspace root
```

## Core Components

### 1. TypeScript SDK — `sdks/typescript/`

The developer-facing SDK, published as [`@nekzus/neural-mesh`](https://www.npmjs.com/package/@nekzus/neural-mesh) on NPM. Designed as a **drop-in replacement for MCP** with native NMP capabilities.

| Feature | Description |
|---|---|
| `NmpServer` | Register tools, resources, and prompts with Zod schema validation |
| `NmpClient` | Discover and invoke remote tools via P2P mesh |
| `NmpMcpBridge` | JSON-RPC 2.0 adapter for legacy MCP clients (Claude Desktop, Cursor) |
| Guardian AST | Static analysis of WASM imports to prevent sandbox escapes |
| PII Shield | Real-time detection and blocking of sensitive data (Email, Credit Card, IP, Phone) |
| Worker Pool | Multi-threaded execution via Piscina for non-blocking cryptography |
| PQC (Kyber) | Post-Quantum key encapsulation for transport layer security |
| ZK Receipts | Zero-Knowledge proof verification for computational integrity |

[Read the TypeScript SDK Documentation](./sdks/typescript/README.md)

---

### 2. Rust SDK — `sdks/rust/`

The native Rust crates providing zero-overhead bindings to the NMP mesh.

| Crate | Description |
|---|---|
| `nmp-core` | Shared Protobuf definitions compiled with `tonic` + `prost` |
| `nmp-client` | High-level agent interface with Kyber PQC, AES-256-GCM encryption, and Kademlia DHT discovery |

[Read the Rust SDK Documentation](./sdks/rust/README.md)

---

### 3. Mesh Node Server — `servers/mesh-node/`

The high-performance Data Node host, written in Rust. This is where injected WASM logic executes.

| Module | Description |
|---|---|
| `executor.rs` | Wasmtime + WASI sandbox with fuel-based CPU limits and `nmp::push_event` host syscall |
| `guardian.rs` | Zero-Time AST structural scanning via `wasmparser` — rejects malicious imports before JIT |
| `grpc.rs` | Tonic gRPC server with PQC intent negotiation and streaming logic responses |
| `p2p.rs` | libp2p Kademlia DHT for decentralized peer discovery over Noise/QUIC |
| `zk.rs` | ZK-SNARK proof generation engine (Journal + Seal) via SHA-256 cryptographic hashing |
| `tee.rs` | Trusted Execution Environment trait bounds for AWS Nitro Enclaves / Intel SGX |

[Read the Mesh Node Documentation](./servers/mesh-node/README.md)

## Technical Stack

| Layer | Technology |
|---|---|
| **Transport** | Tonic gRPC + Protobuf v3 |
| **Peer Discovery** | libp2p (Kademlia DHT, Noise Protocol, QUIC) |
| **Sandboxing** | Wasmtime 14.0 + WASI Preview 1 |
| **Post-Quantum Crypto** | ML-KEM-768 (Kyber) + AES-256-GCM |
| **Static Analysis** | `wasmparser` AST inspection |
| **Integrity Proofs** | ZK-SNARKs (RISC Zero architecture) |
| **TypeScript Runtime** | Node.js ≥ 20 + Piscina Worker Threads |
| **Code Quality** | Biome.js (TS) + Clippy (Rust) |
| **CI/CD** | GitHub Actions + semantic-release + NPM Provenance |

## Getting Started

### Install the TypeScript SDK

```bash
npm install @nekzus/neural-mesh
```

### Build the Rust Backend

```bash
# Add WASI target
rustup target add wasm32-wasip1

# Compile the full workspace
cargo build

# Run tests
cargo test
```

## Documentation

- [Official Documentation Portal (Mintlify)](https://nekzus-32.mintlify.app/)
- [Ask DeepWiki about NMP](https://deepwiki.com/Nekzus/Neural-Mesh-Protocol)
- [Protocol Specification](./protocol/SPECIFICATION.md)
- [Project Manifesto](./MANIFESTO.md)

## Contributing

We welcome contributions! Please read our [Contributing Guide](./CONTRIBUTING.md) for guidelines on how to get involved. This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © [Nekzus](https://github.com/Nekzus)
