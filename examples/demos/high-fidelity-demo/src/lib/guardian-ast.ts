// Guardian AST: Zero-Time Static Analysis
// Scans server-side code before considering it for execution.

export const GuardianAST = {
	RESTRICTED_PATTERNS: [
		// Module Loading
		/require\s*\(/g,
		/import\s*\(/g,
		// File System & OS
		/\bfs\./g,
		/child_process/g,
		// Globals & Context Escapes
		/\bprocess\b/g,
		/\bglobal\b/g,
		/\bglobalThis\b/g,
		/\bwindow\b/g,
		// Dynamic Execution
		/\beval\s*\(/g,
		/new\s+Function\s*\(/g,
		/constructor\s*\(\s*['"]return/g,
		// Network
		/\bfetch\s*\(/g,
		/\bXMLHttpRequest\b/g,
		// Prototype Pollution
		/__proto__/g,
		/Object\.setPrototypeOf/g,
	],

	/**
	 * Inspects incoming code looking for Sandbox Escape attempts or unauthorized I/O.
	 * If it finds a doubtful pattern, it throws a lethal exception (Zero-Time Block).
	 */
	inspect(code: string): void {
		console.error(
			`\n🛡️  [Guardian AST] Initializing Zero-Time heuristic inspection...`,
		);
		console.error(
			`🛡️  [Guardian AST] Payload size: ${Buffer.byteLength(code, "utf8")} bytes`,
		);

		for (const pattern of GuardianAST.RESTRICTED_PATTERNS) {
			if (pattern.test(code)) {
				console.error(
					`\n🚨 [Guardian AST] FATAL: SANDBOX ESCAPE ATTEMPT DETECTED!`,
				);
				console.error(
					`🚨 [Guardian AST] Infringed rule: ${pattern.toString()}`,
				);
				console.error(
					`🚨 [Guardian AST] The payload contained unauthorized I/O towards the Host.`,
				);
				throw new Error(
					"[NMP] AST Security Violation. The server rejected the payload.",
				);
			}
		}

		console.error(
			`✅ [Guardian AST] Successful inspection. No malicious patterns detected.`,
		);
	},
};
