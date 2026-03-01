// Guardian AST: Zero-Time Static Analysis
// Scans server-side code before considering it for execution.

export const GuardianAST = {
	RESTRICTED_PATTERNS: [
		/require\(['"]fs['"]\)/g,
		/require\(['"]child_process['"]\)/g,
		/fs\.(read|write)FileSync/g,
		/process\.(env|exit|cwd|kill)/g,
		/fetch\(/g,
		/eval\(/g,
		/new Function\(/g,
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
