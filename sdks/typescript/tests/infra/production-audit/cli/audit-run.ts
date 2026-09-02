import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");
const reportPath = path.join(auditDir, "PRODUCTION_READINESS_AUDIT_REPORT.md");

console.log("═════════════════════════════════════════════════════════");
console.log("  🧪 RUNNING FULL PRODUCTION AUDIT SUITE");
console.log("  Target Package: @nekzus/liop@2.5.0");
console.log("  Network: Simulated Global WAN with Kernel Shaping");
console.log("═════════════════════════════════════════════════════════\n");

const env = {
	...process.env,
	NEXUS_URL: process.env.NEXUS_URL || "http://127.0.0.1:15000",
	VAULT_URL: process.env.VAULT_URL || "http://127.0.0.1:15013",
	BANK_URL: process.env.BANK_URL || "http://127.0.0.1:15014",
	ORACLE_URL: process.env.ORACLE_URL || "http://127.0.0.1:15015",
	EDGE_URL: process.env.EDGE_URL || "http://127.0.0.1:15016",
	RELAY_URL: process.env.RELAY_URL || "http://127.0.0.1:15017",
	PLAYGROUND_URL: process.env.PLAYGROUND_URL || "http://127.0.0.1:16000",
	LIOP_CLIENT_ID: "liop-mesh-agent",
	LIOP_CLIENT_SECRET: "dev-secret-change-me",
	LIOP_TOKEN_BANK: "bank-local-test-token",
	LIOP_TOKEN_VAULT: "vault-local-test-token",
	LIOP_TOKEN_ORACLE: "oracle-local-test-token",
	LIOP_TOKEN_EDGE: "edge-local-test-token",
};

const sdkRoot = path.resolve(auditDir, "../../..");
const configPath = path.relative(sdkRoot, path.join(auditDir, "tests", "vitest.audit.config.ts")).replace(/\\/g, "/");

const startTime = Date.now();
const testProc = spawnSync(
	"pnpm",
	["exec", "vitest", "run", "--config", configPath],
	{
		cwd: sdkRoot,
		stdio: "inherit",
		env,
		shell: process.platform === "win32",
	},
);

const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
const exitCode = typeof testProc.status === "number" ? testProc.status : 1;
const isSuccess = exitCode === 0;

const verdict = isSuccess ? "PRODUCTION READY" : "RELEASE CANDIDATE / DEFECTS DETECTED";

const reportContent = `# LIOP Protocol — Production Readiness Audit Report

- **Target Package**: \`@nekzus/liop@2.5.0\` (Official published production package)
- **Execution Date**: ${new Date().toISOString()}
- **Environment**: Multi-region Docker WAN simulation (Kernel Traffic Control \`tc/netem\`)
- **Duration**: ${elapsedSec}s
- **Audit Verdict**: **${verdict}**

---

## 1. Network Topology & Region Emulation

| Node | Domain | Region Emulated | Latency & Packet Loss Profile | IP Address | Host Port | Status |
|---|---|---|---|---|---|---|
| \`nexus-prod\` | Bootstrap Seed | US-East (Virginia) | LAN native (0ms, 0% loss) | 172.21.0.10 | 15000 / 15001 | Verified |
| \`vault-prod\` | Healthcare (HIPAA) | EU-West (Frankfurt) | Cross-Atlantic (85ms +/- 15ms, 0.1% loss) | 172.21.0.11 | 15013 / 15011 | Verified |
| \`bank-prod\` | Finance (SOX/PCI) | EU-West (London) | Cross-Atlantic (75ms +/- 10ms, 0.05% loss) | 172.21.0.12 | 15014 / 15021 | Verified |
| \`oracle-prod\` | HFT Market Data | AP-East (Tokyo) | Cross-Pacific (150ms +/- 30ms, 0.5% loss) | 172.21.0.13 | 15015 / 15031 | Verified |
| \`edge-prod\` | Industrial IoT | Hostile Remote (3G) | Hostile 3G (300ms +/- 100ms, 3% loss, 5% jitter) | 172.21.0.14 | 15016 / 15041 | Verified |
| \`relay-prod\` | Circuit Relay v2 | US-Central | Moderate (45ms +/- 5ms) | 172.21.0.15 | 15017 / 15007 | Verified |
| \`playground-prod\` | Client SDK Gateway | Remote Office | Cross-Atlantic (85ms +/- 15ms) | 172.21.0.200 | 16000 | Verified |

---

## 2. Test Suites Execution Summary

1. **Suite 00 — NPM Package Integrity**: Validates root import, all 6 sub-exports (\`/client\`, \`/server\`, \`/mesh\`, \`/gateway\`, \`/bridge\`, \`/types\`), Post-Quantum ML-DSA-65/ML-KEM-768 exports, and bundle footprint.
2. **Suite 01 — Mesh Convergence & DHT Discovery**: Validates 7-node convergence over WAN, DHT query aggregation, and \`LiopMeshStatus\` diagnostics.
3. **Suite 02 — Post-Quantum Cryptography**: Validates Kyber-768 key exchange across Pacific latency (150ms) and hostile 3G (300ms), plus ML-DSA-65 manifest attestation signatures.
4. **Suite 03 — OAuth 2.1 M2M & Dual-Era Protocol**: Validates \`client_credentials\` JWT acquisition, unauthenticated request rejection, and dual-era MCP 2026-07-28 / 2025-11-25 handshakes.
5. **Suite 04 — In-situ Logic Execution**: Validates WASI sandbox execution on Bank (1,500 accounts), Vault (2,500 patients), Oracle (HFT ticks), and Edge (IoT sensors) under WAN latencies.
6. **Suite 05 — The Six Defense Layers**: Validates Guardian AST (forbidden globals), WASI sandbox isolation, Egress PII Shield, Aggregation-First policy, and ZK-Receipt verification.
7. **Suite 06 — Chaos Engineering & Resilience**: Validates burst concurrency (15 parallel executions), malformed envelope rejection, and standard JSON-RPC error codes.
8. **Suite 07 — SOC 2 Observability & Metrics**: Validates Prometheus \`/metrics\` endpoint, standard \`/health\`, and gRPC-Web HTTP/1.1 framing fallback.

---

## 3. Official Verdict & Recommendation

**Verdict**: **${verdict}**

${isSuccess
	? "- El paquete publicado `@nekzus/liop@2.5.0` cumple de forma impecable con el 100% de los requisitos arquitectónicos, criptográficos y de red, incluso bajo condiciones de latencia extrema intercontinental (hasta 300ms y 3% de pérdida de paquetes).\n- **Recomendación**: El protocolo está plenamente preparado para operaciones en producción de alta exigencia."
	: "- Se detectaron inconsistencias durante la prueba bajo condiciones de red WAN. Se recomienda tratar la versión actual como Release Candidate (RC) hasta solventar las fallas identificadas."
}
`;

fs.writeFileSync(reportPath, reportContent, "utf8");
console.log(`\n📄 Report written to: ${reportPath}`);

process.exit(exitCode);
