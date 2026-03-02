import { describe, it, expect } from "vitest";
import { PiiScanner, PII_PATTERNS } from "./pii.js";

describe("PiiScanner (The Shield V2 - Military Grade)", () => {
    const scanner = new PiiScanner([
        PII_PATTERNS.EMAIL,
        PII_PATTERNS.IP_ADDRESS,
        PII_PATTERNS.CREDIT_CARD,
        "forbidden-word"
    ]);

    it("should detect PII in plain strings", () => {
        expect(scanner.scan("Contact me at user@realdomain.com")).toBe(PII_PATTERNS.EMAIL.name);
        expect(scanner.scan("My IP is 192.168.1.1")).toBe(PII_PATTERNS.IP_ADDRESS.name);
        expect(scanner.scan("Here is a forbidden-word")).toBe("forbidden-word");
    });

    it("should exclude safe words to prevent false positives", () => {
        expect(scanner.scan("Contact me at test@example.com")).toBe(null); // @example.com is safe
        expect(scanner.scan("Connecting to 127.0.0.1")).toBe(null); // Localhost is safe
        expect(scanner.scan("Binding to 0.0.0.0")).toBe(null);
    });

    it("should detect valid credit cards using Luhn algorithm", () => {
        // Valid Visa test number (42... passes Luhn)
        expect(scanner.scan("Here is my card: 4242 4242 4242 4242")).toBe(PII_PATTERNS.CREDIT_CARD.name);
        expect(scanner.scan("Unformatted: 4242424242424242")).toBe(PII_PATTERNS.CREDIT_CARD.name);
    });

    it("should NOT detect fake credit cards (Algorithmic rejection)", () => {
        // Just changed the last digit; Luhn should fail
        expect(scanner.scan("Fake ID number: 4242 4242 4242 4243")).toBe(null);
    });

    it("should detect forbidden keys in objects (Key Auditing)", () => {
        expect(scanner.scan({ id: "123" })).toBe("Forbidden Key: id");
        expect(scanner.scan({ nested: { ssn: "999-00-9999" } })).toBe("Forbidden Key: ssn");
        expect(scanner.scan({ name: "John Doe" })).toBe("Forbidden Key: name");
    });

    it("should detect PII in nested values", () => {
        expect(scanner.scan({ metadata: "Email: leak@leak.com" })).toBe(PII_PATTERNS.EMAIL.name);
        expect(scanner.scan([{ info: "1.1.1.1" }])).toBe(PII_PATTERNS.IP_ADDRESS.name);
    });

    it("should handle circular references without crashing", () => {
        const obj: any = { safe: "data" };
        obj.self = obj;
        expect(scanner.scan(obj)).toBe(null);
    });

    it("should handle different phone formats if added", () => {
        const phoneScanner = new PiiScanner([PII_PATTERNS.PHONE]);
        expect(phoneScanner.scan("Call +1-800-555-0199")).toBe(PII_PATTERNS.PHONE.name);
        expect(phoneScanner.scan("My number is (800) 555-0199")).toBe(PII_PATTERNS.PHONE.name);

        // Fake numbers or sequential shouldn't trigger if validator is smart
        expect(phoneScanner.scan("My number is 1234567890")).toBe(null);
        expect(phoneScanner.scan("ID: 0000000000")).toBe(null);
    });
});
