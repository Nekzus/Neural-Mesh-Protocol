// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { PII_PATTERNS, PiiScanner } from "./pii.js";

describe("PiiScanner Context-Aware Egress Guard", () => {
	const scanner = new PiiScanner(
		[
			PII_PATTERNS.EMAIL,
			PII_PATTERNS.PHONE,
			PII_PATTERNS.SSN,
			PII_PATTERNS.CREDIT_CARD,
		],
		["id", "name", "ssn"],
	);

	it("should NOT trigger PII violations on pure numeric values (False Positive Elimination)", async () => {
		// total_transactions: 1234567890 would trigger PHONE regex as a string, but as a number it must pass
		expect(await scanner.scan(1234567890)).toBeNull();

		// avg_balance: 45123.4567 would trigger SSN regex as a string, but as a number it must pass
		expect(await scanner.scan(45123.4567)).toBeNull();

		// Inside an object structure:
		const cleanData = {
			avg_balance: 45123.4567,
			total_transactions: 1234567890,
			is_active: true,
			status: "SUCCESS",
		};
		expect(await scanner.scan(cleanData)).toBeNull();
	});

	it("should STILL detect actual string PII (True Positive Preservation)", async () => {
		// Real formatted string values must trigger
		expect(await scanner.scan("My SSN is 456-78-9012")).toBe(
			PII_PATTERNS.SSN.name,
		);
		expect(await scanner.scan("Call me at +1 (555) 123-4567")).toBe(
			PII_PATTERNS.PHONE.name,
		);
		expect(await scanner.scan("Email: user@realdomain.com")).toBe(
			PII_PATTERNS.EMAIL.name,
		);

		// Inside an object:
		const dirtyData = {
			avg_balance: 45123.4567,
			email: "leak@realdomain.com",
		};
		expect(await scanner.scan(dirtyData)).toBe("EMAIL");

		const dirtyValue = {
			avg_balance: 45123.4567,
			notes: "Sent ssn 456-78-9012 via chat",
		};
		expect(await scanner.scan(dirtyValue)).toBe(PII_PATTERNS.SSN.name);
	});

	it("should STILL detect forbidden keys and fuzzy key matches even with numeric values", async () => {
		// Key names that are forbidden must trigger even if the value is a number
		expect(await scanner.scan({ id: 1234567 })).toBe("Forbidden Key: id");
		expect(await scanner.scan({ ssn: 999009999 })).toBe("Forbidden Key: ssn");
		expect(await scanner.scan({ patientId: 45 })).toBe(
			'Forbidden Key (fuzzy): patientId matches boundary pattern "id"',
		);
	});
});
