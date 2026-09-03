import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDockerCompose } from "../../cli/_dockerCompose.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");

const shouldBuild = !process.argv.includes("--no-build");
const sleepMs = Number.parseInt(process.env.LIOP_AUDIT_SLEEP_MS ?? "25000", 10);

console.log("═════════════════════════════════════════════════════════");
console.log("  🚀 LIOP PRODUCTION READINESS AUDIT (@nekzus/liop@2.5.0)");
console.log("  Simulating 7 Multi-Region WAN Nodes with Kernel TC/Netem");
console.log("═════════════════════════════════════════════════════════");

runDockerCompose(["-f", "docker-compose.production-audit.yml", "config", "--quiet"], { cwd: auditDir });

if (shouldBuild) {
	console.log("\n🔨 [Stage 1/2] Building production audit image from NPM package @nekzus/liop@2.5.0...");
	const buildArgs = process.argv.includes("--no-cache") ? ["build", "--no-cache"] : ["build"];
	runDockerCompose(["-f", "docker-compose.production-audit.yml", ...buildArgs], { cwd: auditDir });
}

console.log("\n🌐 [Stage 2/2] Launching 8 Tri-Tier Sovereign Mesh nodes across Tier 1, 2, and 3...");
const services = ["nexus-prod", "blg-prod", "vault-prod", "bank-prod", "oracle-prod", "edge-prod", "relay-prod", "playground-prod"];
runDockerCompose(["-f", "docker-compose.production-audit.yml", "up", "-d", ...services], { cwd: auditDir });

console.log(`\n⏳ Waiting ${sleepMs / 1000}s for P2P mesh convergence under WAN latency...`);
await new Promise((r) => setTimeout(r, sleepMs));

console.log("\n═════════════════════════════════════════════════════════");
console.log("  ✅ REALISTIC WAN PRODUCTION AUDIT MESH — READY");
console.log("═════════════════════════════════════════════════════════");
runDockerCompose(["-f", "docker-compose.production-audit.yml", "ps", "--format", "table {{.Name}}\t{{.Status}}\t{{.Ports}}"], { cwd: auditDir });

console.log("\n  Endpoints:");
console.log("    Nexus Gateway:    http://localhost:15000");
console.log("    Playground UI:    http://localhost:16000");
console.log("    Metrics:          http://localhost:15000/metrics");
console.log("═════════════════════════════════════════════════════════\n");
