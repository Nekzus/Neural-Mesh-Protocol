# Neural Mesh Protocol - Cargo Core (rust-app)

This directory contains the underlying high-performance, system-level components of the NMP mesh network, written cleanly in a Rust 2021 Cargo Workspace.

## Components Breakdown

The Cargo Workspace is divided into modular crates:

- **`nmp-core`**: The shared library storing standardized Protobuf definitions via `prost` and `tonic`.
- **`nmp-server`**: The Data Node host. Contains the heavy-duty `wasmtime-wasi` sandbox. It securely receives foreign WebAssembly logic, virtualizes strict capabilities (like read-only filesystem access for specific directories), and executes the payload at near-native speeds.
- **`nmp-client`**: The Agent Node injector. It searches for resources across the Kademlia DHT and pushes compiled `.wasm` tasks via Tonic gRPC to remote servers.
- **`wasm-filter`**: An example rust-based `wasm32-wasip1` payload that demonstrates safe logic-on-origin injection.
- **`wasm-watchdog`**: An example long-running `wasm32-wasip1` task that demonstrates streaming continuous events via gRPC async channels back to the agent.

## Security (Zero-Trust)

This backend implements a ferocious security posture:
- **WASI Sandboxing**: Payload instances cannot touch sockets, memory, or undeclared files not strictly mapped by the Server.
- **Decentralized Identity**: Peer Identifiers are mathematically derived from Ed25519 keypairs. Kademlia routing is cryptographically verified to evade Eclipse attacks.
- **PQC Handshakes (Draft)**: Experimental integrations with `pqcrypto-kyber` to thwart "Harvest Now, Decrypt Later" quantum attacks on the mesh intent negotiation.
- **Guardian AST (Draft)**: Future ML-based traversal of the WAT/WASM structures to deny complex obfuscation loops before instantiation.

## Building and Running

To compile the workspace, you must have the `wasm32-wasip1` target installed for the example filters.

```bash
# Add WebAssembly WASI target
rustup target add wasm32-wasip1

# Compile everything, including filters
cargo build

# Run the complete test suite
cargo test
```

*Note: The `target/` directory of this workspace is heavily isolated and ignored globally from version control to prevent repository bloat.*
