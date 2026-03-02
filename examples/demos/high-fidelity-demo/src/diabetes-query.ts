import { NmpCompiler } from "./lib/nmp-compiler.js";
import { theVaultServer } from "./server-node.js";

const SCENARIO_DIABETES = `
function(records) {
  let count = 0;
  for (const p of records) {
    if (p.condition.toLowerCase().includes('diabetes')) count++;
  }
  return { analysis: "Diabetes Patients Count", count };
}`;

async function main() {
	console.log(`🤖 Compiling Medical Filter for Diabetes...`);
	const payload = NmpCompiler.compileAnalysis(
		SCENARIO_DIABETES,
		"DiabetesAnalytics",
	);

	console.log(`🚀 Sending Logic-on-Origin Payload to The Vault...`);
	const result = await theVaultServer.callTool({
		name: "nmp_audit_sandbox",
		arguments: { payload }, // HERE IS THE REQUIRED PAYLOAD
	});

	const msg = result.content.find(
		(c: Record<string, unknown>) => c.type === "text",
	);
	if (result.isError) {
		if (msg && typeof msg.text === "string")
			console.error(`🛡️ Blocked:`, msg.text);
	} else {
		if (msg && typeof msg.text === "string") {
			const data = JSON.parse(msg.text);
			console.log(`\n💎 EXACT QUERY RESULT:`, data.computation_result);
			console.log(`✅ STARK ZK-Receipt:`, data.zk_receipt);
		}
	}
	process.exit(0);
}

main().catch(console.error);
