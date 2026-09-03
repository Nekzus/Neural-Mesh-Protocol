/**
 * Tier 1 Enclave Swarm Key Bootstrapper
 *
 * Generates the canonical 95-byte PSK for Tier 1 Sovereign Enclaves
 * and stores it at /app/data/tier1.psk (shared Docker volume).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createSwarmKey, saveSwarmKey } from "@nekzus/liop";

async function main() {
	const dataDir = process.env.LIOP_DATA_DIR || "/app/data";
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const pskPath = path.join(dataDir, "tier1.psk");
	if (fs.existsSync(pskPath)) {
		console.log(`[Tier1-PSK] Existing Swarm Key found at: ${pskPath}`);
		return;
	}

	console.log(`[Tier1-PSK] Generating new 95-byte Swarm Key for Tier 1 Enclave...`);
	const psk = createSwarmKey();
	await saveSwarmKey(psk, pskPath);
	console.log(`[Tier1-PSK] ✅ Swarm Key persisted to: ${pskPath}`);
}

main().catch((err) => {
	console.error("[Tier1-PSK] Fatal error generating Swarm Key:", err);
	process.exit(1);
});
