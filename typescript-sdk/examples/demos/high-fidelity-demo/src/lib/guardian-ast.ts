// Guardian AST: Zero-Time Static Analysis
// Escanea el código del lado del servidor antes de considerarlo para ejecución.

export class GuardianAST {
    private static readonly RESTRICTED_PATTERNS = [
        /require\(['"]fs['"]\)/g,
        /require\(['"]child_process['"]\)/g,
        /fs\.(read|write)FileSync/g,
        /process\.(env|exit|cwd|kill)/g,
        /fetch\(/g,
        /eval\(/g,
        /new Function\(/g,
    ];

    /**
     * Inspecciona el código entrante buscando intentos de Sandbox Escape o I/O no autorizado.
     * Si encuentra un patrón dudoso, lanza una excepción letal (Zero-Time Block).
     */
    public static inspect(code: string): void {
        console.log(`\n🛡️  [Guardian AST] Inicializando inspección heurística de Zero-Time...`);
        console.log(`🛡️  [Guardian AST] Tamaño del payload: ${Buffer.byteLength(code, 'utf8')} bytes`);

        for (const pattern of this.RESTRICTED_PATTERNS) {
            if (pattern.test(code)) {
                console.error(`\n🚨 [Guardian AST] FATAL: INTENTO DE SANDBOX ESCAPE DETECTADO!`);
                console.error(`🚨 [Guardian AST] Regla infringida: ${pattern.toString()}`);
                console.error(`🚨 [Guardian AST] El payload contenía I/O no autorizado hacia el Host.`);
                throw new Error("[NMP] AST Security Violation. The server rejected the payload.");
            }
        }

        console.log(`✅ [Guardian AST] Inspección exitosa. No se detectaron patrones maliciosos.`);
    }
}
