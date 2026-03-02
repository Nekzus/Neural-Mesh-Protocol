# Neural Mesh Protocol: The Blind Analyst (Hi-Fi Demo)

An industrial-grade, dynamic, high-fidelity demonstration simulating a complete Neural Mesh Protocol (NMP) Logic-on-Origin injection attack, defense, and execution cycle.

## Overview
Unlike legacy systems (like MCP) that pull data toward large language models, NMP pushes computational **WebAssembly (or JIT-compiled JS)** logic directly to the source of the data ("The Vault"). 

This demo runs a simulated P2P connection between `agent.ts` and `server-node.ts` to showcase:
1. **The Power:** Running varied logic payloads (Hypertension analysis, Age computation) over sensitive mock data without extracting it.
2. **The Shield:** Actively triggering Zero-Time protection mechanisms via AST validation (Sandbox Escape) and Fuel Exhaustion limiters (Logic Bombs).

## The Scenarios
The agent implements four dynamic scenarios that can be injected at will:

### 1. `average-age` (The Power)
Computes the mean age of all patient records within the secure dataset and returns a **ZK-Receipt** (Zero-Knowledge proof representation) proving the math was correctly executed inside the Vault.

### 2. `hypertension` (The Power)
Filters specifically for patients with a `Hypertension` condition and a Risk Score `> 0.8`. Demonstrates complex conditional filtering pushed to the origin without leaking individual records.

### 3. `ast-attack` (The Shield)
I/O Injection Attempt. The Client attempts to send a logic module that invokes `fs.readFileSync('/etc/passwd')`. The Vault's **Guardian AST** catches the malicious heuristic and completely blocks execution with a Zero-Time fatal drop.

### 4. `fuel-exhaustion` (The Shield)
The Infinite Loop Attack. The Client sends an innocent-looking loop that attempts to spin out CPU cycles indefinitely. The server's **WASI Sandbox** measures cycle execution against its Fuel Reserve and successfully amputates the process throwing a `Resource Exhaustion` error, protecting the Host infrastructure.

## How to Run
All scenarios can be ran utilizing `pnpm`:

```bash
# Run The Power Scenarios
pnpm run hifi:agent --scenario=average-age
pnpm run hifi:agent --scenario=hypertension

# Run The Shield Scenarios
pnpm run hifi:agent --scenario=ast-attack
pnpm run hifi:agent --scenario=fuel-exhaustion
```

## Security Stack Displayed
- **Simulated Kyber ML-KEM-768 & AES-256-GCM Handshakes.**
- **Guardian AST:** Deep packet / Logic inspection pre-compilation.
- **Wasmtime WASI Fuel Management:** Strict instruction limit encapsulation.
- **Simulated Hardware ZK-SNARK Proving.** 

## Repository Architecture Highlight
By executing `agent.ts` you will see how it completely encapsulates the intended remote operations by seamlessly sending a compiled manifest into the isolated context of `server-node.ts`.
