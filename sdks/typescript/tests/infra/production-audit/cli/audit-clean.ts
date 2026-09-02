import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDockerCompose } from "../../cli/_dockerCompose.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const auditDir = path.resolve(here, "..");

console.log("🧹 Tearing down production audit containers and volumes...");
runDockerCompose(["-f", "docker-compose.production-audit.yml", "down", "-v", "--remove-orphans"], { cwd: auditDir });
console.log("✅ Production audit environment cleaned successfully.");
