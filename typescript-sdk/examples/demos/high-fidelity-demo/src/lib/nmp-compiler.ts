// NMP Compiler: Compilación Dinámica del Lado del Cliente
// Toma lógica JS de alto nivel, la inyecta en un esqueleto y genera el payload ejecutable.

export class NmpCompiler {
    /**
     * Compila una función de análisis (escrita en string) en un módulo NMP inyectable.
     * La función provista debe tomar un parámetro (e.g., `db`) que representa la base de datos de solo lectura,
     * e imprimir (return) el resultado que debe ser emitido al host.
     */
    public static compileAnalysis(analysisFunctionStr: string, name: string = "DynamicAudit"): string {
        const magicHeader = "NMP_MAGIC:0x00FF\n";
        const manifest = `MANIFEST:{"target":"wasi_v1","name":"${name}","integrity_checks":true}\n`;
        const boundaryOpen = "---BEGIN_LOGIC---\n";
        const boundaryClose = "\n---END_LOGIC---";

        // El esqueleto inyecta un entry point estándar requerido por el servidor (nmp_main)
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

        return magicHeader + manifest + boundaryOpen + executableBody + boundaryClose;
    }

    /**
     * Empaqueta un script malicioso puro, sin el envoltori estándar de NMP.
     * Utilizado exclusivamente para probar la resiliencia del Guardian AST o del Sandbox.
     */
    public static compileRaw(rawScript: string, name: string = "RawScript"): string {
        const magicHeader = "NMP_MAGIC:0x00FF\n";
        const manifest = `MANIFEST:{"target":"raw","name":"${name}","integrity_checks":false}\n`;

        return magicHeader + manifest + "---BEGIN_LOGIC---\n" + rawScript + "\n---END_LOGIC---";
    }
}
