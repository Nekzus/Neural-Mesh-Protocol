import { describe, it, expect } from "vitest";
import { PiiScanner, PII_PATTERNS } from "./pii.js";

describe("PiiScanner (The Shield V2)", () => {
    const scanner = new PiiScanner([
        PII_PATTERNS.EMAIL,
        PII_PATTERNS.IP_ADDRESS,
        PII_PATTERNS.CREDIT_CARD,
        "forbidden-word"
    ]);

    it("should detect PII in plain strings", () => {
        expect(scanner.scan("Contact me at test@example.com")).toBe(PII_PATTERNS.EMAIL.source);
        expect(scanner.scan("My IP is 192.168.1.1")).toBe(PII_PATTERNS.IP_ADDRESS.source);
        expect(scanner.scan("Here is a forbidden-word")).toBe("forbidden-word");
    });

    it("should detect forbidden keys in objects (Key Auditing)", () => {
        expect(scanner.scan({ id: "123" })).toBe("Forbidden Key: id");
        expect(scanner.scan({ nested: { ssn: "999-00-9999" } })).toBe("Forbidden Key: ssn");
        expect(scanner.scan({ name: "John Doe" })).toBe("Forbidden Key: name");
    });

    it("should detect PII in nested values", () => {
        expect(scanner.scan({ metadata: "Email: leak@leak.com" })).toBe(PII_PATTERNS.EMAIL.source);
        expect(scanner.scan([{ info: "1.1.1.1" }])).toBe(PII_PATTERNS.IP_ADDRESS.source);
    });

    it("should handle circular references without crashing", () => {
        const obj: any = { safe: "data" };
        obj.self = obj;
        expect(scanner.scan(obj)).toBe(null);
    });

    it("should allow safe data", () => {
        expect(scanner.scan("Clean text")).toBe(null);
        expect(scanner.scan({ count: 42, label: "Total" })).toBe(null);
    });

    it("should handle different phone formats if added", () => {
        const phoneScanner = new PiiScanner([PII_PATTERNS.PHONE]);
        expect(phoneScanner.scan("Call +1-555-0199")).toBe(PII_PATTERNS.PHONE.source);
        expect(phoneScanner.scan("My number is 555.0199")).toBe(PII_PATTERNS.PHONE.source);
    });
});
