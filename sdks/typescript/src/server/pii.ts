/**
 * NMP Professional PII Engine (The Shield V2 - Tier-1 Military Edition)
 * Implements high-fidelity detection based on NIST and OWASP standards.
 * Features Multi-Layer Verification (Regex + Algorithmic Validators).
 */

/**
 * Validates a credit card number using the Luhn algorithm.
 * Prevents false positives from random 16-digit IDs.
 */
function isLuhnValid(cardNumber: string): boolean {
	const digits = cardNumber.replace(/\D/g, "");
	if (digits.length < 13 || digits.length > 19) return false;

	let sum = 0;
	let isEven = false;

	for (let i = digits.length - 1; i >= 0; i--) {
		let digit = parseInt(digits.charAt(i), 10);

		if (isEven) {
			digit *= 2;
			if (digit > 9) {
				digit -= 9;
			}
		}

		sum += digit;
		isEven = !isEven;
	}

	return sum % 10 === 0;
}

export type PiiRuleDefinition = {
	name: string;
	pattern: string | RegExp;
	validator?: (match: string) => boolean;
};

export type PiiRule = string | RegExp | PiiRuleDefinition;

export const PII_PATTERNS = {
	EMAIL: {
		name: "EMAIL",
		pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
		validator: (match: string) =>
			!match.endsWith("@example.com") && !match.endsWith("@test.com"),
	} as PiiRuleDefinition,
	CREDIT_CARD: {
		name: "CREDIT_CARD",
		pattern: /\b(?:\d[ -]*?){13,16}\b/g,
		validator: isLuhnValid,
	} as PiiRuleDefinition,
	IP_ADDRESS: {
		name: "IP_ADDRESS",
		pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
		validator: (match: string) => {
			const safeIps = ["127.0.0.1", "0.0.0.0", "255.255.255.255"];
			if (safeIps.includes(match)) return false;
			// Validate valid IPv4 ranges
			const parts = match.split(".").map(Number);
			return parts.every((p) => p >= 0 && p <= 255);
		},
	} as PiiRuleDefinition,
	PHONE: {
		name: "PHONE",
		// Strict boundary to avoid matching long numeric IDs wrapped in symbols
		pattern: /(?:(?:\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4})\b/g,
		validator: (match: string) => {
			const digits = match.replace(/\D/g, "");
			if (digits.length < 7 || digits.length > 15) return false;
			// Reject fake test numbers like 0000000000 or 1234567890
			if (/^(\d)\1+$/.test(digits)) return false;
			if (digits === "1234567890") return false;
			return true;
		},
	} as PiiRuleDefinition,
	// Keys that should never be exported in a JSON object
	FORBIDDEN_KEYS:
		/^(id|ssn|social_security|password|token|secret|address|phone|email|name|nombre|apellido|birth|nacimiento)$/i,
};

export class PiiScanner {
	private patterns: PiiRule[];

	constructor(patterns: PiiRule[] = []) {
		this.patterns = patterns;
	}

	/**
	 * Scans any input (string, object, array) for PII violations.
	 * Returns the pattern/rule name that triggered the violation, or null if safe.
	 */
	public scan(input: unknown, seen = new WeakSet<object>()): string | null {
		if (input === null || input === undefined) return null;

		// 1. String Scan (Direct Regex/String/Definition check)
		if (typeof input === "string") {
			return this.checkString(input);
		}

		// 2. Recursive Objects/Arrays Scan
		if (typeof input === "object") {
			// Protection against circular references
			if (seen.has(input as object)) return null;
			seen.add(input as object);

			if (Array.isArray(input)) {
				for (const element of input) {
					const violation = this.scan(element, seen);
					if (violation) return violation;
				}
			} else {
				for (const [key, value] of Object.entries(
					input as Record<string, unknown>,
				)) {
					// Check Keys (Industrial Best Practice: Key Auditing)
					if (PII_PATTERNS.FORBIDDEN_KEYS.test(key)) {
						return `Forbidden Key: ${key}`;
					}

					// Recurse into values
					const violation = this.scan(value, seen);
					if (violation) return violation;
				}
			}
		}

		return null;
	}

	private checkString(text: string): string | null {
		for (const rule of this.patterns) {
			if (typeof rule === "string") {
				if (text.toLowerCase().includes(rule.toLowerCase())) {
					return rule;
				}
			} else if (rule instanceof RegExp) {
				if (rule.global) rule.lastIndex = 0;
				if (rule.test(text)) {
					return rule.source;
				}
			} else if (typeof rule === "object" && rule !== null) {
				// PiiRuleDefinition (Military Grade Multi-layer)
				const def = rule as PiiRuleDefinition;

				if (typeof def.pattern === "string") {
					if (text.toLowerCase().includes(def.pattern.toLowerCase())) {
						if (!def.validator || def.validator(def.pattern)) {
							return def.name;
						}
					}
				} else if (def.pattern instanceof RegExp) {
					if (def.pattern.global) def.pattern.lastIndex = 0;

					// Use matchAll or exec to get the specific match for the validator
					let match = def.pattern.exec(text);
					while (match !== null) {
						const matchedText = match[0];
						if (!def.validator || def.validator(matchedText)) {
							return def.name;
						}
						if (!def.pattern.global) break; // Break if not global
						match = def.pattern.exec(text);
					}
				}
			}
		}
		return null;
	}
}
