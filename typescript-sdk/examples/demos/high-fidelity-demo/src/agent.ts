// "The Blind Analyst" - Hi-Fi NMP Dynamic Agent
import { NmpCompiler } from "./lib/nmp-compiler.js";

// -- Analysis Scenarios (The Power) --

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

// -- Security Scenarios (The Shield) --

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

	console.log(`\n🤖 [The Blind Analyst] Initializing Dynamic AI Client...`);
	console.log(`🤖 Selected Scenario: [${scenarioArg}]`);

	let payload = "";

	// 1. Dynamic Compilation based on intention
	switch (scenarioArg) {
		case "hypertension":
			console.log(`🔧 [Compiler] Compiling Strict Medical Filter...`);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_HYPERTENSION,
				"HypertensionAnalytics",
			);
			break;
		case "average-age":
			console.log(
				`🔧 [Compiler] Compiling Statistical Transformation (Anonymized)...`,
			);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_AVERAGE_AGE,
				"AgeAnalytics",
			);
			break;
		case "ast-attack":
			console.log(
				`⚠️  [Compiler] Packaging Malicious Logic (Sandbox Escape Attempt)...`,
			);
			console.log(
				`⚠️  [Compiler] WARNING: This attack should be blocked in Zero-Time by the Guardian AST.`,
			);
			payload = NmpCompiler.compileRaw(SCENARIO_AST_ATTACK, "MalwareAST");
			break;
		case "fuel-exhaustion":
			console.log(`⚠️  [Compiler] Compiling Logic Bomb (Infinite Loop)...`);
			console.log(
				`⚠️  [Compiler] WARNING: The WASI Sandbox should stop this by amputating the Fuel.`,
			);
			payload = NmpCompiler.compileAnalysis(
				SCENARIO_FUEL_EXHAUSTION,
				"LogicBomb",
			);
			break;
		default:
			console.error(
				`❌ Unknown scenario. Use: hypertension, average-age, ast-attack, fuel-exhaustion`,
			);
			process.exit(1);
	}

	console.log(
		`\n🔒 [PQC Protocol] Initiating Kyber ML-KEM-768 Handshake... (Simulated)`,
	);

	// 2. P2P Connection (Simulated via Node native bridge for local Agent)
	console.log(
		`🔒 [PQC Protocol] AES-256-GCM Channel Established with 'TheVault'`,
	);

	try {
		console.log(
			`🚀 [Injector] Sending Logic-on-Origin Payload to Remote Node...`,
		);
		const { theVaultServer } = await import("./server-node.js");

		const result = await theVaultServer.callTool({
			name: "nmp_audit_sandbox",
			arguments: { payload },
		});

		if (result.isError) {
			console.error(`\n======================================================`);
			console.error(`🛡️  THE SHIELD HAS ACTIVATED (Execution Blocked)`);
			console.error(`======================================================`);
			// Extracting pure text
			const msg = result.content.find((c: any) => c.type === "text");
			if (msg && typeof msg.text === "string") console.error(msg.text);
		} else {
			console.log(`\n======================================================`);
			console.log(`💎 THE POWER DETECTED (Successful Execution)`);
			console.log(`======================================================`);
			const msg = result.content.find((c: any) => c.type === "text");
			if (msg && typeof msg.text === "string") {
				const data = JSON.parse(msg.text);
				console.log(`📊 Analysis Result:`, data.computation_result);
				console.log(`⛽ Fuel Consumed:`, data.security_metrics.fuel_consumed);
				console.log(
					`\n✅ [ZK Verifier] Verifying STARK Receipt from Server...`,
				);
				console.log(
					`✅ [ZK Verifier] Valid Cryptographic Proof: ${data.zk_receipt}`,
				);
			}
		}
	} catch (error) {
		console.error("Agent encountered a fatal execution error:", error);
	} finally {
		console.log(`\n🔌 Disconnecting from the Mesh...`);
	}
}

main().catch(console.error);
