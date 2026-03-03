import { describe, expect, it } from "vitest";
import { WasiSandbox } from "./wasi-sandbox.js";

describe("WasiSandbox (node:vm Isolation)", () => {
    it("should execute valid JavaScript logic seamlessly", async () => {
        const payload = `
// Valid non-malicious logic
return { total: env.records.length };
`;
        const result = await WasiSandbox.execute(payload);
        expect(result).toBeDefined();
        expect(result.zkReceipt).toBeDefined();
    });

    it("should block attempts to access Node.js globals (VM Escape)", async () => {
        // Even if GuardianAST was bypassed, node:vm should throw ReferenceError since 'process' is undefined in the blank context
        const maliciousPayload = `
return process.env;
`;

        // To test sandbox directly, we temporarily disable the Guardian module for this specific try-catch or ensure it fails inside VM.
        // Since GuardianAST will block the string "process", we obfuscate the string so it bypasses GuardianAST exactly to test node:vm isolation.

        const stealthPayload = `
const p = "proces" + "s";
// Trying to access global process object dynamically
const globalObj = new Function("return this")();
return globalObj[p].env;
`;

        // The VM Context should throw because new Function isn't allowed or globalObj is undefined/null in the isolated context
        const stealthResult = await WasiSandbox.execute(stealthPayload);
        expect(stealthResult.output).toContain("RuntimeException");
    });
});
