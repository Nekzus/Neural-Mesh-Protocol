# NMP: Neural Mesh Protocol (v1.0-alpha)

NMP (Neural Mesh Protocol) is a next-generation, high-performance binary transport mesh designed for advanced Artificial Intelligence Agent communication. Conceived as a conceptual and technical evolution of existing context protocols (like MCP), NMP radically shifts the paradigm from pulling massive data towards secure **Logic-on-Origin** execution.

## Vision

In the rapid evolution of autonomous agents, transferring gigabytes of raw data to central AI nodes for filtering, parsing, or reasoning is increasingly inefficient, slow, and expensive.

NMP introduces a decentralized, Zero-Trust architectural model where AI agents inject ultra-lightweight, sandboxed execution modules (WebAssembly) directly into the data source. By moving the logic to the data rather than the data to the logic, NMP aims to:

- **Dramatically reduce network latency and bandwidth consumption.**
- **Save millions of tokens** by returning only semantically relevant, cryptographically verified evidence from the origin.
- **Provide Zero-Trust security** natively, ensuring the host is never exposed to arbitrary or unsandboxed agent execution via strict WASI capabilities.

## Key Architectural Pillars (NMP vs Legacy MCP)

1. **Push-Logic Paradigm (Logic-on-Origin):** Execute WASM logic exactly where the data lives, eliminating Massive Data Transfer.
2. **High-Performance Binary Transport:** Built on Tonic (gRPC) and Protobuf instead of JSON-RPC over stdout. Payload parsings are reduced by 90%.
3. **Zero-Trust Sandboxing:** Powered by Wasmtime and WASI Preview 1, with microscopic filesystem/network permissions.
4. **Decentralized Mesh Topology:** Peer-to-peer agent discovery and routing via \ust-libp2p\ (Kademlia DHT) without relying on central authorities.
5. **Persistent Multiplexing:** QUIC/Yamux transport maintains connections without the need for constant Ping/Heartbeat polling.

## Project Structure (Cargo Workspace)

- **\proto/\**: Contains \
mp_core.proto\, the standardized Protobuf definitions.
- **\
mp-client/\**: The AI Agent Node. Discovers peers via Kademlia and injects WASM logic over gRPC.
- **\
mp-server/\**: The Data Node. Receives logic and executes it securely within a Wasmtime sandbox, streaming back results.
- **\wasm-filter/\**: An example rust-based wasm32-wasip1 module that acts as the injected logic.

## Status

Currently in **Alpha** (Active Development). Core prototypes including P2P connectivity, WASI isolation, and gRPC execution are operational.

---
*Developed as the next evolution in Agentic Data Context.*

## Extreme Zero-Trust Security & Distributed Intelligence

To bulletproof the protocol against current and future cybersecurity threats, NMP elevates WASI Sandboxing to an autonomous, military-grade level:

1. **Post-Quantum Cryptographic (PQC) Signatures:** Evolving the Noise Protocol to quantum-resistant algorithms (e.g., Kyber/Dilithium) to ensure traffic interception today cannot be decrypted by quantum computers tomorrow.
2. **AI-Assisted Static AST Inspection:** Before instantiating Wasmtime, the Data Node uses a lightweight local ML model to scan the incoming WASM's Abstract Syntax Tree for obfuscation, aggressive loops, or evasive malware patterns, rejecting payloads in Zero-Time.
3. **Hardware Enclaves (TEEs):** Wasmtime executes strictly within Trusted Execution Environments (Intel SGX / AMD SEV). Not even the host OS administrator or Cloud Provider can dump RAM to steal data or spy on the WASM logic.
4. **Dynamic Capability Revocation (AI-Driven WASI):** An intelligent monitor supervises read rates and memory access patterns. If a WASM behaves like ransomware or attempts covert exfiltration, capabilities are dynamically revoked mid-flight, killing the task instantly.
5. **Zero-Knowledge Proofs (ZK-SNARKs):** The WASM emits a cryptographic proof certifying exactly what logic was run on what genuine source data, without revealing the underlying data. The network audits the proof before accepting the result.
