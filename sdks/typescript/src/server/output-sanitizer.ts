// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Egress Shield Output Sanitizer (NIST SP 800-226 and OWASP DLP 2025 compliant)
 * Recursively sanitizes execution outputs by rounding floating-point numbers
 * and clamping negative values to zero floor where appropriate.
 *
 * Implements absolute immutability, returning a fresh copy of the data.
 */

export interface OutputSanitizerConfig {
	/** Maximum decimal places for floating-point values (default: 4) */
	maxDecimalPlaces?: number;
	/** Clamp negative values to zero floor (default: true) */
	clampNonNegative?: boolean;
}

const DEFAULT_CONFIG: Required<OutputSanitizerConfig> = {
	maxDecimalPlaces: 4,
	clampNonNegative: true,
};

/**
 * Recursively walks a JSON-like tree, rounding floats and clamping negative values.
 *
 * @param output - The raw or DP-modified output object/value to sanitize
 * @param config - Sanitization parameters (rounding depth, negative clamping)
 * @returns A sanitized deep copy of the output
 */
export function sanitizeOutput(
	output: unknown,
	config?: OutputSanitizerConfig,
): unknown {
	const merged = { ...DEFAULT_CONFIG, ...config };
	const seen = new WeakSet<object>();

	function walk(node: unknown): unknown {
		if (node === null || node === undefined) {
			return node;
		}

		if (typeof node === "number") {
			if (!Number.isFinite(node)) {
				return node;
			}

			let value = node;

			// 1. Clamp negative values to 0 if configured
			if (merged.clampNonNegative && value < 0) {
				value = 0;
			}

			// 2. Round to maximum decimal places
			const factor = 10 ** merged.maxDecimalPlaces;
			value = Math.round(value * factor) / factor;

			return value;
		}

		if (typeof node === "string" || typeof node === "boolean") {
			return node;
		}

		if (typeof node === "object") {
			// Circular reference protection
			if (seen.has(node as object)) {
				return node;
			}
			seen.add(node as object);

			if (Array.isArray(node)) {
				return node.map((item) => walk(item));
			}

			const result: Record<string, unknown> = {};
			for (const [key, val] of Object.entries(
				node as Record<string, unknown>,
			)) {
				result[key] = walk(val);
			}
			return result;
		}

		return node;
	}

	return walk(output);
}
