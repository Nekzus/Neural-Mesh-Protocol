# Security Policy

## Supported Versions

We provide security updates and patches for the following release channels:

| Channel | Release Range | Security Support |
| :--- | :--- | :---: |
| `main` (`latest`) | `>= 2.3.0` | Supported |
| `beta` (`@beta`) | `>= 2.1.0-beta.x` | Supported |
| `alpha` (`@alpha`) | `>= 2.1.0-alpha.x` | Supported |
| Legacy (v1.x) | `< 2.0.0` | End of Life (Unsupported) |

---

## Reporting a Security Vulnerability

The Logic-Injection-on-Origin Protocol (LIOP) operates under a strict **Zero-Trust** security model with military-grade protections against data extraction, side-channel attacks, and sandbox escapes.

If you discover a potential security vulnerability, memory isolation breach, PII extraction vector, or cryptographic weakness, **please DO NOT create a public GitHub issue**.

### Preferred Reporting Method
Privately submit a report through GitHub Security Advisories:
👉 **[Open a Private Security Advisory](https://github.com/Nekzus/LIOP/security/advisories/new)**

### Security Scope & Triage Invariants
Reports regarding the following critical layers receive expedited triage:
1. **Layer 1 (Guardian AST)**: Static inspection bypasses or allowlist escapes in injected logic.
2. **Layer 2 (WASI / V8 Sandboxing)**: Global namespace poisoning escapes or prototype contamination vectors.
3. **Layer 3 (Taint Analysis & IFC)**: Information Flow Control breaches deriving sensitive data through side channels.
4. **Layer 4 (Egress PII Shield)**: Unsanitized credit card, SSN, email, or credential leakage through egress filters.
5. **Layer 5 (Cryptographic Proofs & ZK-Receipts)**: HMAC-SHA256 tampering, ML-KEM-768 key exchange flaws, or ML-DSA-65 signature forgery.

### Response Timeline
* **Initial Assessment**: Within 48 hours.
* **Triage & Reproduction**: Within 5 business days.
* **Coordinated Disclosure**: Fixes will be backported to `alpha`, `beta`, and released in `main` with full CVE attribution prior to public disclosure.

---

## Cryptographic Software & Export Administration Notice

This distribution includes cryptographic software implementing Post-Quantum algorithms (ML-KEM-768 / FIPS 203, ML-DSA-65 / FIPS 204), symmetric ciphers (AES-256-GCM), and cryptographic hashing (SHA-256 / HMAC-SHA256).

Under the United States Export Administration Regulations (EAR), cryptographic software is classified under **Export Control Classification Number (ECCN) 5D002**. Because this software is open source, publicly available, and published without charge, it qualifies for the publicly available open-source exception under **EAR § 742.15(b)** (TSU / Publicly Available Technology and Software).

However, individuals and entities downloading, exporting, or re-exporting this software are solely responsible for ensuring compliance with all applicable local laws, sanctions, and export control regulations in their respective jurisdictions.

---

## Sandbox Governance & Host Responsibility Disclaimer

In accordance with Sections 7 and 8 of the Apache License, Version 2.0:
1. **Host Configuration**: LIOP provides the WASI / V8 sandboxing runtime, AST Guardian, and Information Flow Control (IFC) filters on an "AS IS" basis without warranties of any kind.
2. **Resource Quotas**: The operator of each origin data-host node bears sole responsibility for configuring appropriate deterministic fuel limits (`calculateAstInstructionFuel`), memory allocations, and network boundaries.
3. **Execution Sovereignty**: Injected logic executes inside host environments under host supervision; node operators must maintain defense-in-depth isolation (including multi-tier mesh zoning and OS-level cgroups/namespaces) appropriate for their regulatory classification (HIPAA, SOC 2, PCI-DSS).

