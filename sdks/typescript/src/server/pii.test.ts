// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { PII_PATTERNS, PiiScanner } from "./pii.js";

describe("PiiScanner (The Shield V2 - Military Grade)", () => {
	const scanner = new PiiScanner(
		[
			PII_PATTERNS.EMAIL,
			PII_PATTERNS.IP_ADDRESS,
			PII_PATTERNS.CREDIT_CARD,
			"forbidden-word",
		],
		["id", "ssn", "name"],
	);

	it("should detect PII in plain strings", async () => {
		expect(await scanner.scan("Contact me at user@realdomain.com")).toBe(
			PII_PATTERNS.EMAIL.name,
		);
		expect(await scanner.scan("My IP is 192.168.1.1")).toBe(
			PII_PATTERNS.IP_ADDRESS.name,
		);
		expect(await scanner.scan("Here is a forbidden-word")).toBe(
			"forbidden-word",
		);
	});

	it("should exclude safe words to prevent false positives", async () => {
		expect(await scanner.scan("Contact me at test@example.com")).toBe(null); // @example.com is safe
		expect(await scanner.scan("Connecting to 127.0.0.1")).toBe(null); // Localhost is safe
		expect(await scanner.scan("Binding to 0.0.0.0")).toBe(null);
	});

	it("should detect valid credit cards using Luhn algorithm", async () => {
		// Valid Visa test number (42... passes Luhn)
		expect(await scanner.scan("Here is my card: 4242 4242 4242 4242")).toBe(
			PII_PATTERNS.CREDIT_CARD.name,
		);
		expect(await scanner.scan("Unformatted: 4242424242424242")).toBe(
			PII_PATTERNS.CREDIT_CARD.name,
		);
	});

	it("should NOT detect fake credit cards (Algorithmic rejection)", async () => {
		// Just changed the last digit; Luhn should fail
		expect(await scanner.scan("Fake ID number: 4242 4242 4242 4243")).toBe(
			null,
		);
	});

	it("should detect forbidden keys in objects (Key Auditing)", async () => {
		expect(await scanner.scan({ id: "123" })).toBe("Forbidden Key: id");
		expect(await scanner.scan({ nested: { ssn: "999-00-9999" } })).toBe(
			"Forbidden Key: ssn",
		);
		expect(await scanner.scan({ name: "John Doe" })).toBe(
			"Forbidden Key: name",
		);
	});

	it("should detect PII in nested values", async () => {
		expect(await scanner.scan({ metadata: "Email: leak@leak.com" })).toBe(
			PII_PATTERNS.EMAIL.name,
		);
		expect(await scanner.scan([{ info: "1.1.1.1" }])).toBe(
			PII_PATTERNS.IP_ADDRESS.name,
		);
	});

	it("should handle circular references without crashing", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing circular refs
		const obj: any = { safe: "data" };
		obj.self = obj;
		expect(await scanner.scan(obj)).toBe(null);
	});

	it("should handle different phone formats if added", async () => {
		const phoneScanner = new PiiScanner([PII_PATTERNS.PHONE]);
		expect(await phoneScanner.scan("Call +1-800-555-0199")).toBe(
			PII_PATTERNS.PHONE.name,
		);
		expect(await phoneScanner.scan("My number is (800) 555-0199")).toBe(
			PII_PATTERNS.PHONE.name,
		);

		// Fake numbers or sequential shouldn't trigger if validator is smart
		expect(await phoneScanner.scan("My number is 1234567890")).toBe(null);
		expect(await phoneScanner.scan("ID: 0000000000")).toBe(null);
	});

	it("should detect and block Double JSON Encoding bypass attempts (Zero-Day Regression)", async () => {
		// Custom scanner looking exactly for a JSON key-like string pattern
		const strictScanner = new PiiScanner(['"id":'], ["id"]);

		// The vulnerability: if the agent manually stringifies the output, the double quotes are escaped.
		// A naïve scanner would look for exactly '"id":' and miss it.
		const maliciousPayload = '{"total_records": 12, "data": [{"id":"P001"}]}';

		// With Deep-Parsing Recursion, it should successfully unescape the payload and find the forbidden key 'id'
		expect(await strictScanner.scan(maliciousPayload)).toBe(
			"Forbidden Key: id",
		);

		// Also check that stringified arrays work
		const maliciousArray = '[{"id":"P002"}]';
		expect(await strictScanner.scan(maliciousArray)).toBe("Forbidden Key: id");
	});

	it("should detect and validate IBAN via ISO 7064 Modulo 97-10", async () => {
		const bankingScanner = new PiiScanner([PII_PATTERNS.IBAN]);

		// Valid IBANs
		expect(
			await bankingScanner.scan("Transfer to DE89370400440532013000"),
		).toBe(PII_PATTERNS.IBAN.name);
		expect(await bankingScanner.scan("Payment GB82WEST12345698765432")).toBe(
			PII_PATTERNS.IBAN.name,
		);

		// Invalid IBAN (Checksum altered)
		expect(await bankingScanner.scan("Fake IBAN DE89370400440532013001")).toBe(
			null,
		);
	});

	it("should detect and validate strict Social Security Numbers", async () => {
		const ssnScanner = new PiiScanner([PII_PATTERNS.SSN]);

		// Valid format passing all exclusion rules
		expect(await ssnScanner.scan("My SSN is 456-78-9012")).toBe(
			PII_PATTERNS.SSN.name,
		);

		// Invalid area 000
		expect(await ssnScanner.scan("000-45-6789")).toBe(null);
		// Invalid group 00
		expect(await ssnScanner.scan("123-00-6789")).toBe(null);
		// Invalid serial 0000
		expect(await ssnScanner.scan("123-45-0000")).toBe(null);
		// Sequential and repeating fakes
		expect(await ssnScanner.scan("123-45-6789")).toBe(null);
		expect(await ssnScanner.scan("111-11-1111")).toBe(null);
	});

	it("should detect Passport MRZ patterns", async () => {
		const passportScanner = new PiiScanner([PII_PATTERNS.PASSPORT_MRZ]);
		expect(
			await passportScanner.scan(
				"Scan: P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
			),
		).toBe(PII_PATTERNS.PASSPORT_MRZ.name);
		// Random short garbage
		expect(await passportScanner.scan("P<UTOERI<<")).toBe(null);
	});
});
