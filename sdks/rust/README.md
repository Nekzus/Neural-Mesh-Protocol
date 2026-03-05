<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730727/Neural-Mesh-Protocol/bxasdalv9vwyt7m45vnb.svg">
    <img alt="Neural Mesh Protocol Logo" src="https://res.cloudinary.com/dsvsl0b0b/image/upload/v1772730741/Neural-Mesh-Protocol/koych4jotjoldgo4ydpk.svg" width="700">
  </picture>
</div>

# Neural Mesh Protocol (NMP) - Rust SDK

The `nmp-rust-sdk` provides the foundational bindings, types, and client interfaces to interact with the Neural Mesh natively from Rust applications.

**Design Goal:** To offer a zero-overhead, highly concurrent, and cryptographically secure interface to the NMP ecosystem.

## Workspace Architecture

This directory houses the Rust crates that compose the SDK:

### `crates/core`
The `nmp-core` crate contains the fundamental Protocol Buffer definitions compiled with `tonic` and `prost`. This is the shared dictionary that both the `mesh-node` server and the `client` understand.

### `crates/client`
The `nmp-client` crate is a high-level SDK interface designed for developers who want to write AI Agents in Rust. It abstracts away the complex multiplexing (QUIC/libp2p) and asymmetric cryptography (Kyber) protocols to securely distribute WASM payloads to the mesh.

## Security First (Zero-Trust)

This SDK automatically handles:
- **PQC Handshakes:** Establishing post-quantum secure transport layers over `rust-libp2p`.
- **E2E Encryption:** Encapsulating WASM logic in AES-256-GCM symmetric transport layers.
- **ZK Verifier:** Validating Zero-Knowledge generic receipts (ImageIDs) returned by the host executor.

---
*Developed as the core native toolchain for the Agentic Data Context.*
