# RFC 0001: LIOP Network Topology, Identity Management, and Access Control Standards

```
Network Working Group                                          M. Ortega
Request for Comments: 0001                              Nekzus Solutions
Category: Standards Track                                 September 2026
ISSN: 2026-LIOP-RFC1
```

# Status of this Memo
This document specifies an Internet Standards Track protocol for the decentralized computing and AI community, and requests discussion and suggestions for improvements. Distribution of this memo is unlimited.

# Copyright Notice
Copyright (c) 2026 Nekzus Solutions and the persons identified as the document authors. All rights reserved. This document is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0).

---

## Abstract
This document specifies the standard network topology, node identity verification, access control mechanics, and perimeter gateway invariants for the Logic-Injection-on-Origin Protocol (LIOP). LIOP departs from traditional context-pulling protocols by pushing computational logic to the point of data origin. 

To resolve the tension between open machine-to-machine discoverability and strict data sovereignty, this memo formally specifies the **Tri-Tier Federated Sovereign Mesh Architecture**, defines Machine-to-Machine (M2M) authentication profiles under OAuth 2.1 and RFC 8707, standardizes Scope-Based Role Access Control (RBAC), and specifies the 6-layer defense pipeline enforced by the Border LIO Gateway (BLG).

---

## 1. Introduction and Terminology

### 1.1 Requirements Language
The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

### 1.2 The Logic-Injection-on-Origin (LIO) Postulate
> **Postulate of Origin:** Data MUST remain stationary at its physical and sovereign location of origin. Computational logic MUST be transmitted to the data.

An LIOP Client (Agent) submitting a request MUST NOT demand the transfer of raw entity datasets. Instead, the client MUST transmit executable logic (WASM micro-modules or verified Abstract Syntax Tree representations). The LIOP Server MUST execute this logic in-situ within an isolated sandbox and MUST transmit outward only aggregated results accompanied by verifiable cryptographic receipts.

---

## 2. The Tri-Tier Network Topology

LIOP deployments MUST conform to one or more of the three standardized network tiers defined herein.

```
┌─────────────────────────────────────────────────────────────────┐
│           TIER 3: GLOBAL PUBLIC DISCOVERY BACKBONE              │
│       Anycast BGP Bootstrap Supernodes, Open Discovery          │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Federated Capability Exchange (FCX)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│           TIER 2: SECTORIAL FEDERATED CONSORTIUM MESH           │
│       mTLS (Consortium Root CA) + OAuth 2.1 RFC 8707            │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Asymmetric Ingress Boundary
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│           TIER 1: INTRA-ORGANIZATION SOVEREIGN ENCLAVE          │
│       Isolated Subnets (10.0.0.0/8), WASI Sandbox, Raw Data     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Tier 1: Intra-Organization Sovereign Enclaves
1. **Network Isolation:** Tier 1 nodes MUST bind strictly to private network namespaces, internal subnets (e.g., `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), or loopback interfaces.
2. **WAN Disablement:** Tier 1 nodes MUST configure `enableWAN: false`. Nodes MUST NOT bind to public WAN addresses or accept unverified external ingress traffic.
3. **Multicast Leakage Prevention:** Nodes located within enterprise VLANs SHOULD configure `enableMdns: false` to prevent broadcast of internal topology across shared Layer-2 fabrics.
4. **Data Collocation:** The Tier 1 compute core (WASI isolate) MUST run directly adjacent to the physical database host. Raw records MUST NOT be serialized across external network hops.

### 2.2 Tier 2: Sectorial Federated Consortium Meshes
1. **Consortium Admission:** Nodes participating in Tier 2 MUST present an X.509 certificate chain signed by the accredited Consortium Root CA.
2. **Mutual Transport Security:** All node-to-node links MUST enforce Mutual TLS (mTLS) with hot-reloading support (`CertManager`).
3. **DHT Namespacing:** Consortium peer discovery MUST utilize namespaced Kademlia DHT protocol strings:
   ```
   /liop/consortium/<domain-slug>/kad/1.0.0
   ```
   Consortium nodes MUST NOT publish internal routing records to the public DHT keyspace.
4. **Authorization Anchor:** Access across consortium boundaries MUST be governed by OAuth 2.1 M2M access tokens incorporating RFC 8707 Resource Indicators (`resource: "urn:liop:mesh:consortium"`).

### 2.3 Tier 3: Global Public Discovery Backbone
1. **Bootstrap Supernodes:** The protocol foundation and accredited stewards MUST maintain geographically distributed bootstrap seeds with Anycast BGP routing across a minimum of three continental zones: US-East, EU-Central, and AP-Southeast.
2. **Public Routing Scope:** Public routing MUST utilize the global DHT protocol identifier:
   ```
   /liop/global/kad/2.0.0
   ```
3. **Data Publication Prohibition:** Nodes MUST NOT publish sensitive data records, clinical identifiers, financial records, or internal IP topologies to Tier 3. Content Identifiers (CIDs) advertised to Tier 3 MUST strictly represent Public Service Manifests.

---

## 3. Node and Agent Identity Standards

### 3.1 Node Identity Architecture
Each LIOP node SHALL maintain two distinct cryptographic identities:
1. **Transport Identity (Ed25519):** An Ed25519 keypair whose SHA-256 multihash forms the canonical libp2p `PeerId`. This identity MUST be used for the Noise handshake (`Noise_XX_25519_ChaChaPoly_SHA256`).
2. **Attestation Identity (ML-DSA-65):** A Post-Quantum Digital Signature Standard keypair compliant with NIST FIPS 204. The public key and signature MUST be included in the node's service manifest (`pqcPublicKey`, `pqcSignature`).

### 3.2 Machine-to-Machine (M2M) Agent Authentication
1. **Grant Type:** Autonomous AI agents and client daemons MUST authenticate using the OAuth 2.1 `client_credentials` grant type. Interactive flows (Authorization Code, Implicit, Resource Owner Password) MUST be rejected by the Authorization Server.
2. **JWT Profile:** Access tokens MUST be emitted as JSON Web Tokens (JWT) conforming to RFC 9068.
3. **Algorithm Whitelist:** Token signatures MUST be verified against an algorithm allowlist restricted strictly to `EdDSA` (Ed25519) and `ES256`. Tokens signed with RSA or symmetric HMAC algorithms MUST be rejected.
4. **Audience Enforcement:** The `aud` claim MUST match the configured audience identifier (default: `urn:liop:mesh:api`).

---

## 4. Access Control and RBAC Specifications

### 4.1 Scope-Based Authorization Mapping
Gateways and Resource Servers MUST enforce scope verification prior to executing any MCP JSON-RPC method:

```
+--------------------------+-----------------------+---------------------+
| MCP Method               | Required Scope        | Default Policy      |
+--------------------------+-----------------------+---------------------+
| initialize               | (None)                | PERMIT (Public)     |
| ping                     | (None)                | PERMIT (Public)     |
| notifications/*          | (None)                | PERMIT (Public)     |
| tools/list               | liop:tools:list       | AUTH REQUIRED       |
| tools/call               | liop:tools:call       | AUTH REQUIRED       |
| resources/list           | liop:resources:read   | AUTH REQUIRED       |
| resources/read           | liop:resources:read   | AUTH REQUIRED       |
| prompts/list             | liop:schema:read      | AUTH REQUIRED       |
| prompts/get              | liop:schema:read      | AUTH REQUIRED       |
| (Unrecognized Method)    | (Fail-Closed)         | DENY                |
+--------------------------+-----------------------+---------------------+
```

### 4.2 Fail-Closed Invariant
In accordance with NIST SP 800-207, if an incoming method is not explicitly mapped to an empty scope array, and no valid authorization token is presented, the server MUST reject the invocation immediately with JSON-RPC error code `-32099`.

### 4.3 Protected Resource Metadata (PRM) Endpoint
Servers requiring authentication MUST implement RFC 9728 and serve the metadata document at:
```
/.well-known/oauth-protected-resource
```
When an unauthenticated request is received on a protected endpoint, the server MUST respond with HTTP status `401 Unauthorized` and include the `WWW-Authenticate` header with the `resource_metadata` parameter.

---

## 5. Border LIO Gateway (BLG) Invariants

The Border LIO Gateway acts as the Layer-7 boundary between untrusted external networks and internal sovereign enclaves.

### 5.1 The Asymmetric Traffic Invariant
1. **Ingress Rule (Code Only):** The gateway MUST allow incoming traffic to traverse inward to Tier 1 *only* if the payload consists of executable logic that satisfies Layer 1 (Guardian AST) and Layer 3 (Taint Analysis).
2. **Egress Rule (Aggregations Only):** The gateway MUST NOT permit raw database rows or unaggregated records to exit Tier 1. Outgoing traffic MUST be a verified mathematical reduction sealed with an HMAC-SHA256 ZK-Receipt.

### 5.2 The 6-Layer Security Pipeline
```
[Ingress] ---> [L1: Guardian AST] ---> [L2: WASI Sandbox] ---> [L3: IFC Taint]
                                                                     │
                                                              [In-Situ Compute]
                                                                     │
[Egress]  <--- [L6: ZK-Receipt]  <--- [L5: Aggregation] <--- [L4: PII Shield]
```

1. **L1 (Guardian AST):** Injected code MUST be parsed into an AST. External imports, dynamic evaluation (`eval`), and function invocations outside the 14-symbol allowlist MUST be rejected.
2. **L2 (WASI Sandbox):** Host globals (minimum 25 symbols) MUST be poisoned with traps. Core prototypes (minimum 11 symbols) MUST be frozen via `Object.freeze()`. Fuel metering MUST be enforced.
3. **L3 (IFC Taint Analysis):** Code attempting side-channel extraction via character derivation MUST be rejected.
4. **L4 (Egress PII Shield):** Output MUST pass exact key, fuzzy key, regex, and NER filters.
5. **L5 (Aggregation Policy):** Output MUST represent an $N \to M$ reduction ($M \ll N$) and MUST incorporate Laplace Differential Privacy noise per NIST SP 800-226.
6. **L6 (ZK-Receipt):** The response MUST include an HMAC-SHA256 receipt binding `dataset_hash`, `logic_hash`, and `output_hash`.

---

## 6. Security and Threat Mitigations

### 6.1 BGP-Style Route Hijacking Mitigation
LIOP eliminates implicit trust in routing announcements. All capability descriptors advertised over Kademlia MUST be cryptographically signed with the provider's ML-DSA-65 private key. Descriptors with invalid signatures MUST be discarded immediately upon receipt.

### 6.2 Sybil and Eclipse Attack Mitigation
Tier 2 consortium meshes MUST restrict peer connections to nodes presenting valid Consortium CA certificates. Nodes attempting connections without mutual certificate validation MUST be dropped at the transport layer.

### 6.3 Post-Quantum Forward Secrecy
All transport sessions SHOULD negotiate session keys using **ML-KEM-768 (Kyber)**. Negotiated symmetric secrets MUST feature a maximum lifetime of 3,600 seconds, after which automatic silent re-keying MUST occur.

---

## 7. IANA and Registry Considerations

### 7.1 Well-Known URI Registrations
This document registers the following well-known URI per RFC 8615:
- **URI suffix:** `oauth-protected-resource`
- **Specification:** RFC 9728 / LIOP RFC 0001

### 7.2 OAuth Scope Namespace Registrations
This document establishes the `liop` scope namespace:
- `liop:tools:list` — Read tool declarations and schemas
- `liop:tools:call` — Submit logic for execution
- `liop:resources:read` — Read static resources and manifests
- `liop:schema:read` — Inspect schema definitions
- `liop:mesh:query` — Query mesh routing tables

---

## 8. Normative References
- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- **[RFC8707]** Campbell, B., et al., "Resource Indicators for OAuth 2.0", RFC 8707, February 2020.
- **[RFC9068]** Jones, M., et al., "JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens", RFC 9068, October 2021.
- **[RFC9728]** Jones, M., "OAuth 2.0 Protected Resource Metadata", RFC 9728, 2025.
- **[FIPS203]** National Institute of Standards and Technology, "Module-Lattice-Based Key-Encapsulation Mechanism Standard", FIPS PUB 203, August 2024.
- **[FIPS204]** National Institute of Standards and Technology, "Module-Lattice-Based Digital Signature Standard", FIPS PUB 204, August 2024.
- **[NIST800-207]** Rose, S., et al., "Zero Trust Architecture", NIST Special Publication 800-207, August 2020.
- **[NIST800-226]** National Institute of Standards and Technology, "Guidelines for Evaluating Differential Privacy Guarantees", NIST SP 800-226, 2024.

---

```
Author's Address:
Mauricio Ortega
Nekzus Solutions
Email: dev@nekzus.com
URI: https://github.com/nekzus/liop
```
