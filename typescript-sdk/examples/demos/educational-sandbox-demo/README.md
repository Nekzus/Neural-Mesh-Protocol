# NMP Educational Sandbox Demo

## Objective
This demo is designed for **educational and technical auditing purposes**. It provides a deep dive into the internal components of the Neural Mesh Protocol (NMP) that typically operate transparently within the SDK.

## Key Components
- **NmpCompiler**: Simulation of logic packaging into an NMP binary.
- **GuardianAST**: Security module that performs deep code inspection before instantiation.
- **WasiSandbox**: Isolated execution environment with resource monitoring (Fuel) and virtual filesystem.
- **ZK-Verifier**: Mathematical verification of computational integrity using ZK-Receipts (RISC Zero style).

## How to Run
Ensure you are in the demo directory and that dependencies have been installed at the SDK root.

### 1. Start the Data Node (Server)
```bash
pnpm run start:server
```

### 2. Run the Injector Agent (Client)
```bash
pnpm run start:agent
```

## Workflow
1. The Agent compiles the logic into a secure binary.
2. PQC Handshake (Kyber) and Capsule Sealing (AES-256-GCM) take place.
3. The Server validates the code (AST) and executes it within the Sandbox.
4. Signed results are emitted along with a ZK proof of integrity.
