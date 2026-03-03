// MCP Bridge for "The Vault" - Execution from Cursor/Claude Desktop
import { NmpMcpBridge } from "@nekzus/neural-mesh/bridge";
import { theVaultServer } from "./server-node.js";

async function main() {
	console.error("==================================================");
	console.error(">>> CONNECTING NMP-MCP BRIDGE (Stdio) <<<");
	console.error("==================================================");
	console.error("The Vault is ready to be consumed by an MCP-compatible IDE.");

	// NmpMcpBridge already wraps The Vault and brings up the JSON-RPC protocol over stdio internally
	const bridge = new NmpMcpBridge(theVaultServer);

	// Connect the bridge to listen for commands
	await bridge.connect();

	console.error(
		">>> BRIDGE ACTIVE. Waiting for Logic-on-Origin instructions from the AI...",
	);
}

main().catch((err) => {
	console.error("Fatal Error in MCP Bridge:", err);
	process.exit(1);
});
