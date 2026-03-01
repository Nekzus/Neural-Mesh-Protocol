// Puente MCP para "The Vault" - Ejecución desde Cursor/Claude Desktop
import { NmpMcpBridge } from "@neural-mesh/sdk/bridge";
import { theVaultServer } from "./server-node.js";

async function main() {
	console.error("==================================================");
	console.error(">>> CONECTANDO NMP-MCP BRIDGE (Stdio) <<<");
	console.error("==================================================");
	console.error(
		"The Vault está listo para ser consumido por un IDE compatible con MCP.",
	);

	// NmpMcpBridge ya envuelve The Vault y levanta el protocolo JSON-RPC sobre stdio internamente
	const bridge = new NmpMcpBridge(theVaultServer);

	// Conectar el puente para escuchar comandos
	await bridge.connect();

	console.error(
		">>> PUENTE ACTIVO. Esperando instrucciones Logic-on-Origin de la IA...",
	);
}

main().catch((err) => {
	console.error("Error Fatal en el MCP Bridge:", err);
	process.exit(1);
});
