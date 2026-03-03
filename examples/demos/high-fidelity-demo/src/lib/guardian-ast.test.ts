import { describe, expect, it } from "vitest";
import { GuardianAST } from "./guardian-ast.js";

describe("GuardianAST (Heuristics Fortification)", () => {
    it("should allow safe, algorithmic code", () => {
        const code = `
        const data = env.records;
        const mapped = data.map(d => d.age * 2);
        return mapped;
        `;
        expect(() => GuardianAST.inspect(code)).not.toThrow();
    });

    it("should block Sandbox Escapes via Require", () => {
        expect(() => GuardianAST.inspect("require('fs')")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("import('child_process')")).toThrow(/AST Security Violation/);
    });

    it("should block Global/Context Exfiltration", () => {
        expect(() => GuardianAST.inspect("return process.env.SECRET_KEY")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("console.log(globalThis)")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("window.location")).toThrow(/AST Security Violation/);
    });

    it("should block Prototype Pollution vectors", () => {
        expect(() => GuardianAST.inspect("Object.setPrototypeOf(env, {})")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("env.__proto__.admin = true")).toThrow(/AST Security Violation/);
    });

    it("should block dynamic logic execution", () => {
        expect(() => GuardianAST.inspect("eval('2+2')")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("new Function('return process')")).toThrow(/AST Security Violation/);
        expect(() => GuardianAST.inspect("constructor('return process')()")).toThrow(/AST Security Violation/);
    });
});
