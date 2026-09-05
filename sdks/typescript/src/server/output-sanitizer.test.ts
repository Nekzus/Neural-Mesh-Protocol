// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { sanitizeOutput } from "./output-sanitizer.js";

describe("Output Sanitizer", () => {
	it("should round floats to default 4 decimal places", () => {
		const input = 45123.456789;
		const expected = 45123.4568;
		expect(sanitizeOutput(input)).toBe(expected);
	});

	it("should round floats to custom decimal places", () => {
		const input = 45123.456789;
		expect(sanitizeOutput(input, { maxDecimalPlaces: 2 })).toBe(45123.46);
		expect(sanitizeOutput(input, { maxDecimalPlaces: 0 })).toBe(45123);
	});

	it("should clamp negative values to 0 by default", () => {
		const input = -12.34567;
		expect(sanitizeOutput(input)).toBe(0);
	});

	it("should not clamp negative values if clampNonNegative is false", () => {
		const input = -12.34567;
		expect(sanitizeOutput(input, { clampNonNegative: false })).toBe(-12.3457);
	});

	it("should preserve strings, booleans, null, and undefined", () => {
		expect(sanitizeOutput("hello")).toBe("hello");
		expect(sanitizeOutput(true)).toBe(true);
		expect(sanitizeOutput(false)).toBe(false);
		expect(sanitizeOutput(null)).toBe(null);
		expect(sanitizeOutput(undefined)).toBe(undefined);
	});

	it("should recursively sanitize objects and arrays", () => {
		const input = {
			avg_balance: 45123.456789,
			transaction_count: -5,
			nested: {
				ratio: 0.123456,
				values: [-1.23, 2.34567, "ignore-string", true],
			},
		};

		const expected = {
			avg_balance: 45123.4568,
			transaction_count: 0,
			nested: {
				ratio: 0.1235,
				values: [0, 2.3457, "ignore-string", true],
			},
		};

		expect(sanitizeOutput(input)).toEqual(expected);
	});

	it("should handle circular references without infinite loops", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing circular refs
		const input: any = { value: 1.23456 };
		input.self = input;

		const result = sanitizeOutput(input);
		// It shouldn't crash and should round value
		expect(result).toBeDefined();
		// biome-ignore lint/suspicious/noExplicitAny: testing circular refs
		expect((result as any).value).toBe(1.2346);
	});
});
