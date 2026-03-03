# NMP Production Audit Demo

## Objective
A **Production-Grade Demo** showcasing the clean and direct usage of the Neural Mesh Protocol SDK. This version focuses on real-world "Logic-on-Origin" implementation without external simulations.

## Features
- **Native SDK**: Built exclusively using `@nekzus/neural-mesh`.
- **Zero Simulation**: All cryptography (PQC, AES) and transport (P2P Mesh) are managed internally by the core protocol.
- **Minimalist Architecture**: Designed to demonstrate developer-friendly implementation patterns.

## Requirements
- Node.js LTS
- Built NMP SDK (`pnpm run build` in `sdks/typescript` root).

## How to Run

### 1. Start the Data Node (Server)
```bash
pnpm run start:server
```

### 2. Run the Audit Agent (Client)
```bash
pnpm run start:client
```

## Implementation Notes
This example processes a protected medical database (`medical_records.json`). The audit logic is dispatched from the client and processed on the server without sensitive data ever leaving the origin node.
