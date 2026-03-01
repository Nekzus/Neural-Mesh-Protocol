// NMP Compiler: Dynamic Client-Side Compilation
// Takes high-level JS logic, injects it into a skeleton, and generates the executable payload.

export const NmpCompiler = {
	/**
	 * Compiles an analysis function (written as a string) into an injectable NMP module.
	 * The provided function must take a parameter (e.g., `db`) representing the read-only database,
	 * and return the result that should be emitted to the host.
	 */
	compileAnalysis(
		analysisFunctionStr: string,
		name: string = "DynamicAudit",
	): string {
		const magicHeader = "NMP_MAGIC:0x00FF\n";
		const manifest = `MANIFEST:{"target":"wasi_v1","name":"${name}","integrity_checks":true}\n`;
		const boundaryOpen = "---BEGIN_LOGIC---\n";
		const boundaryClose = "\n---END_LOGIC---";

		// The skeleton injects a standard entry point required by the server (nmp_main)
		const executableBody = `
const _clientLogic = ${analysisFunctionStr};

function nmp_main(env) {
    if (!env || !env.records) {
        throw new Error("Missing records in NMP Sandbox environment.");
    }
    const result = _clientLogic(env.records);
    return typeof result === 'object' ? JSON.stringify(result) : String(result);
}
    `.trim();

		return (
			magicHeader + manifest + boundaryOpen + executableBody + boundaryClose
		);
	},

	/**
	 * Packages a pure malicious script, without the standard NMP wrapper.
	 * Used exclusively to test the resilience of the Guardian AST or Sandbox.
	 */
	compileRaw(rawScript: string, name: string = "RawScript"): string {
		const magicHeader = "NMP_MAGIC:0x00FF\n";
		const manifest = `MANIFEST:{"target":"raw","name":"${name}","integrity_checks":false}\n`;

		return (
			magicHeader +
			manifest +
			"---BEGIN_LOGIC---\n" +
			rawScript +
			"\n---END_LOGIC---"
		);
	},
};
