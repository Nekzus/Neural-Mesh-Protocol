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
	console.log(`🤖 Compilando Filtro Médico para Diabetes...`);
	const payload = NmpCompiler.compileAnalysis(
		SCENARIO_DIABETES,
		"DiabetesAnalytics",
	);

	console.log(`🚀 Enviando Payload Logic-on-Origin a The Vault...`);
	const result = await theVaultServer.callTool({
		name: "nmp_audit_sandbox",
		arguments: { payload }, // AQUI ESTÁ EL PAYLOAD REQUERIDO
	});

	const msg = result.content.find((c: any) => c.type === "text");
	if (result.isError) {
		if (msg && typeof msg.text === "string")
			console.error(`🛡️ Bloqueado:`, msg.text);
	} else {
		if (msg && typeof msg.text === "string") {
			const data = JSON.parse(msg.text);
			console.log(
				`\n💎 RESULTADO EXACTO DE LA CONSULTA:`,
				data.computation_result,
			);
			console.log(`✅ ZK-Receipt STARK:`, data.zk_receipt);
		}
	}
	process.exit(0);
}

main().catch(console.error);
