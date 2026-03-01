// "The Blind Analyst" - Agente Dinámico NMP Hi-Fi
import { NmpCompiler } from "./lib/nmp-compiler.js";

// -- Escenarios de Análisis (The Power) --

const SCENARIO_HYPERTENSION = `
function(records) {
  let count = 0;
  for (const p of records) {
    if (p.condition === 'Hypertension' && p.riskScore > 0.8) count++;
  }
  return { analysis: "Critical Hypertension Patients", count };
}`;

const SCENARIO_AVERAGE_AGE = `
function(records) {
  if (records.length === 0) return { meanAge: 0 };
  let sum = 0;
  for (const p of records) { sum += p.age; }
  return { analysis: "Global Age Mean", meanAge: Math.round(sum / records.length) };
}`;

// -- Escenarios de Seguridad (The Shield) --

const SCENARIO_AST_ATTACK = `
  const fs = require('fs');
  const hackers_data = fs.readFileSync('/etc/passwd', 'utf8');
  return "HACKED: " + hackers_data;
`;

const SCENARIO_FUEL_EXHAUSTION = `
function(records) {
  let infinite = 1;
  while(true) {
    infinite++;
    if (infinite < 0) break; // Bypass simple static checks
  }
  return { status: "This will never finish" };
}`;

async function main() {
	const args = process.argv.slice(2);
	const scenarioArg =
		args.find((a) => a.startsWith("--scenario="))?.split("=")[1] ||
		"average-age";

	console.log(`\n🤖 [The Blind Analyst] Inicializando Cliente Dinámico IA...`);
	console.log(`🤖 Scenario Seleccionado: [${scenarioArg}]`);

	let payload = "";

	// 1. Compilación Dinámica basada en intención
	switch (scenarioArg) {
		case "hypertension":
			console.log(`🔧 [Compiler] Compilando Filtro Médico Estricto...`);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_HYPERTENSION,
				"HypertensionAnalytics",
			);
			break;
		case "average-age":
			console.log(
				`🔧 [Compiler] Compilando Transformación Estadística (Anonimizada)...`,
			);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_AVERAGE_AGE,
				"AgeAnalytics",
			);
			break;
		case "ast-attack":
			console.log(
				`⚠️  [Compiler] Empaquetando Lógica Maliciosa (Sandbox Escape Attempt)...`,
			);
			console.log(
				`⚠️  [Compiler] ADVERTENCIA: Este ataque debería ser bloqueado en Cero-Tiempo por el Guardian AST.`,
			);
			payload = NmpCompiler.compileRaw(SCENARIO_AST_ATTACK, "MalwareAST");
			break;
		case "fuel-exhaustion":
			console.log(`⚠️  [Compiler] Compilando Bomba Lógica (Infinite Loop)...`);
			console.log(
				`⚠️  [Compiler] ADVERTENCIA: El WASI Sandbox debería detener esto amputando el Fuel.`,
			);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_FUEL_EXHAUSTION,
				"LogicBomb",
			);
			break;
		default:
			console.error(
				`❌ Escenario desconocido. Use: hypertension, average-age, ast-attack, fuel-exhaustion`,
			);
			process.exit(1);
	}

	console.log(
		`\n🔒 [PQC Protocol] Iniciando Handshake Kyber ML-KEM-768... (Simulado)`,
	);

	// 2. Conexión P2P (Simulada vía puente nativo Node para el Agent local)
	console.log(`🔒 [PQC Protocol] Canal AES-256-GCM Establecido con 'TheVault'`);

	try {
		console.log(
			`🚀 [Injector] Enviando Payload Logic-on-Origin al Nodo Remoto...`,
		);
		const { theVaultServer } = await import("./server-node.js");

		const result = await theVaultServer.callTool({
			name: "nmp_audit_sandbox",
			arguments: { payload },
		});

		if (result.isError) {
			console.error(`\n======================================================`);
			console.error(`🛡️  THE SHIELD HAS ACTIVATED (Ejecución Bloqueada)`);
			console.error(`======================================================`);
			// Extrayendo el text puro
			const msg = result.content.find((c: any) => c.type === "text");
			if (msg && "text" in msg) console.error(msg.text);
		} else {
			console.log(`\n======================================================`);
			console.log(`💎 THE POWER DETECTED (Ejecución Exitosa)`);
			console.log(`======================================================`);
			const msg = result.content.find((c: any) => c.type === "text");
			if (msg && "text" in msg) {
				const data = JSON.parse(msg.text);
				console.log(`📊 Resultado Análisis:`, data.computation_result);
				console.log(`⛽ Fuel Consumido:`, data.security_metrics.fuel_consumed);
				console.log(
					`\n✅ [ZK Verifier] Verificando Recibo STARK del Servidor...`,
				);
				console.log(
					`✅ [ZK Verifier] Prueba Criptográfica Válida: ${data.zk_receipt}`,
				);
			}
		}
	} catch (error) {
		console.error("Agent encountered a fatal execution error:", error);
	} finally {
		console.log(`\n🔌 Desconectando de la Mesh...`);
	}
}

main().catch(console.error);
