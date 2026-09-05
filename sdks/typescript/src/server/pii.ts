// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Professional PII Engine (The Shield V2 - Tier-1 Military Edition)
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

/**
 * Validates an International Bank Account Number (IBAN) using ISO 7064 Modulo 97.
 * Uses BigInt algebra to avoid JS floating point truncation with 30-digit numbers.
 */
function isIbanValid(iban: string): boolean {
	const sanitized = iban.replace(/\s+/g, "").toUpperCase();

	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(sanitized)) return false;

	const rearranged = sanitized.substring(4) + sanitized.substring(0, 4);

	let numericString = "";
	for (let i = 0; i < rearranged.length; i++) {
		const charCode = rearranged.charCodeAt(i);
		if (charCode >= 65 && charCode <= 90) {
			numericString += (charCode - 55).toString();
		} else if (charCode >= 48 && charCode <= 57) {
			numericString += rearranged.charAt(i);
		} else {
			return false;
		}
	}

	try {
		return BigInt(numericString) % 97n === 1n;
	} catch (_e) {
		return false;
	}
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
	SSN: {
		name: "SSN",
		pattern: /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,
		validator: (match: string) => {
			const digits = match.replace(/\D/g, "");
			if (digits.length !== 9) return false;

			const area = parseInt(digits.substring(0, 3), 10);
			if (area === 0 || area === 666 || area >= 900) return false;

			const group = parseInt(digits.substring(3, 5), 10);
			if (group === 0) return false;

			const serial = parseInt(digits.substring(5, 9), 10);
			if (serial === 0) return false;

			if (/^(\d)\1+$/.test(digits) || digits === "123456789") return false;

			return true;
		},
	} as PiiRuleDefinition,
	IBAN: {
		name: "IBAN",
		pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}\b/gi,
		validator: isIbanValid,
	} as PiiRuleDefinition,
	PASSPORT_MRZ: {
		name: "PASSPORT_MRZ",
		// Machina Readable Zone line match for standard international passports
		pattern: /\bP[A-Z<][A-Z<]{3}[A-Z0-9<]{39}(?:\b|\s|$)/g,
	} as PiiRuleDefinition,
};

/**
 * Regional and Cultural Security Presets for Out-Of-The-Box compliance.
 * Developers can override, merge, or omit these based on local laws.
 */
export const PII_PRESETS = {
	GLOBAL_STRICT: [
		PII_PATTERNS.EMAIL,
		PII_PATTERNS.CREDIT_CARD,
		PII_PATTERNS.IP_ADDRESS,
		PII_PATTERNS.PHONE,
		PII_PATTERNS.PASSPORT_MRZ,
		PII_PATTERNS.IBAN,
	],
	US_COMPLIANT: [
		PII_PATTERNS.EMAIL,
		PII_PATTERNS.CREDIT_CARD,
		PII_PATTERNS.IP_ADDRESS,
		PII_PATTERNS.PHONE,
		PII_PATTERNS.SSN,
		PII_PATTERNS.PASSPORT_MRZ,
	],
	EU_GDPR: [
		PII_PATTERNS.EMAIL,
		PII_PATTERNS.CREDIT_CARD,
		PII_PATTERNS.IP_ADDRESS,
		PII_PATTERNS.PHONE,
		PII_PATTERNS.IBAN,
		PII_PATTERNS.PASSPORT_MRZ,
	],
};

export class PiiScanner {
	private patterns: PiiRule[];
	private forbiddenKeysSet: Set<string>;
	private nerScanner: import("./ner-scanner.js").NerScanner | null;

	/**
	 * Safelist of keys that contain forbidden substrings but are NOT PII.
	 * Prevents false positives from fuzzy matching (e.g., "grid" contains "id").
	 */
	private static readonly KEY_SAFELIST = new Set([
		// Common words containing "id" substring
		"grid",
		"video",
		"android",
		"identity",
		"provide",
		"override",
		"validate",
		"hidden",
		"widget",
		"guidelines",
		"beside",
		"guideline",
		"outside",
		"inside",
		"collide",
		"decide",
		"divide",
		"aside",
		"ride",
		"side",
		"wide",
		"hide",
		"tide",
		"pride",
		"bride",
		"slide",
		"guide",
		"stride",
		"oxide",
		"dioxide",
		"suicide",
		"homicide",
		"pesticide",
		"valid",
		"invalid",
		"void",
		"avoid",
		// Common words containing "name" substring
		"diagnosis",
		"medication",
		"namespace",
		"namesake",
		"rename",
		"filename",
		"hostname",
		"typename",
		"unnamed",
		"renamed",
		// Common words containing "phone" substring
		"phonetic",
		"phoneme",
		"microphone",
		"headphone",
		"telephone",
		"saxophone",
		"smartphone",
		// Common words containing "address" substring
		"streetview",
		"addressable",
		"addressing",
		// Common words containing "city" substring
		"cityscape",
		"electricity",
		"capacity",
		"velocity",
		"opacity",
		// Common technical terms
		"timestamp",
		"timezone",
		// LIOP Protocol Internal Keys (must never be blocked)
		"image_id",
		"computation_result",
		"zk_receipt",
		"testid",
		"toolid",
		"sessionid",
		"peerid",
		"nodeid",
		"requestid",
		"correlationid",
		"traceid",
		"spanid",
	]);

	/**
	 * Short forbidden tokens (< 4 chars) that require boundary-aware matching.
	 * Uses regex boundary detection to avoid false positives.
	 */
	private shortTokenBoundaryPatterns: Map<string, RegExp>;

	/**
	 * Long forbidden tokens (>= 4 chars) that use substring containment.
	 */
	private longForbiddenTokens: string[];

	constructor(
		patterns: PiiRule[] = [],
		forbiddenKeys: string[] = [],
		nerScanner?: import("./ner-scanner.js").NerScanner | null,
	) {
		this.patterns = patterns;
		this.forbiddenKeysSet = new Set(forbiddenKeys.map((k) => k.toLowerCase()));
		this.nerScanner = nerScanner ?? null;

		// Pre-compute fuzzy matching structures for performance
		this.shortTokenBoundaryPatterns = new Map();
		this.longForbiddenTokens = [];

		for (const token of this.forbiddenKeysSet) {
			if (token.length < 4) {
				// Short tokens: require word boundary (camelCase, snake_case, kebab-case, or exact)
				// "id" matches: "patientId", "record_id", "user-id", "id"
				// "id" does NOT match: "grid", "video", "android"
				this.shortTokenBoundaryPatterns.set(
					token,
					new RegExp(
						(() => {
							// Build a case-insensitive character class pattern for each letter
							// e.g. "id" -> "[iI][dD]" — used for snake/kebab/exact matches only
							const ciPattern = token
								.split("")
								.map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
								.join("");
							// camelCase: strictly requires uppercase first letter preceded by lowercase
							// e.g. "patientId" matches, "valid_ages" does NOT
							const camelPattern = `[a-z]${token.charAt(0).toUpperCase()}${token.slice(1)}`;
							return (
								`(?:^|[_-])${ciPattern}(?:$|[_-])|` + // snake/kebab boundary
								`${camelPattern}(?:$|[A-Z_-])|` + // camelCase boundary (strict uppercase start)
								`^${ciPattern}$` // exact match
							);
						})(),
					),
				);
			} else {
				this.longForbiddenTokens.push(token);
			}
		}
	}

	/**
	 * Scans any input (string, object, array) for PII violations.
	 * Returns the pattern/rule name that triggered the violation, or null if safe.
	 *
	 * Detection pipeline (fail-fast):
	 *   1. Exact key match (O(1) Set lookup)
	 *   2. Fuzzy key match (boundary detection for short tokens, substring for long)
	 *   3. Regex/algorithmic pattern match on string values
	 *   4. NER content scan on string values (if enabled)
	 */
	public async scan(
		input: unknown,
		seen = new WeakSet<object>(),
	): Promise<string | null> {
		if (input === null || input === undefined) return null;

		// 1. String Scan (Direct Regex/String/Definition check)
		if (typeof input === "string") {
			// SECURITY PATCH: JSON Deep-Parsing Recursion (Fortification V2)
			// Defeats Double JSON Encoding bypasses by forcefully parsing stringified JSON back into objects.
			const trimmed = input.trim();
			if (
				(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
				(trimmed.startsWith("[") && trimmed.endsWith("]"))
			) {
				try {
					const parsed = JSON.parse(trimmed);
					// Successfully parsed JSON string. Recursively scan the unescaped object.
					const violation = await this.scan(parsed, seen);
					if (violation) return violation;
				} catch (_e) {
					// Silent fallback: It looked like JSON but wasn't valid. Proceed with raw string check.
				}
			}

			// Check string value against regex patterns
			const patternViolation = this.checkString(input);
			if (patternViolation) return patternViolation;

			// Layer 3: NER Content Scan — detect person names in free-text values
			if (this.nerScanner) {
				const nerResult = await this.nerScanner.scan(input);
				if (nerResult.detected) {
					const personEntity = nerResult.entities.find(
						(e) => e.type === "person",
					);
					if (personEntity) {
						return `PII Entity Detected: person name "${personEntity.text}"`;
					}
				}
			}

			return null;
		}

		// 2. Recursive Objects/Arrays Scan
		if (typeof input === "object") {
			// Protection against circular references
			if (seen.has(input as object)) return null;
			seen.add(input as object);

			if (Array.isArray(input)) {
				for (const element of input) {
					const violation = await this.scan(element, seen);
					if (violation) return violation;
				}
			} else {
				for (const [key, value] of Object.entries(
					input as Record<string, unknown>,
				)) {
					// Layer 1: Exact key match — O(1) constant time
					if (this.forbiddenKeysSet.has(key.toLowerCase())) {
						return `Forbidden Key: ${key}`;
					}

					// Layer 2: Fuzzy key match — catches aliases and variations
					const fuzzyViolation = this.checkKeyFuzzy(key);
					if (fuzzyViolation) return fuzzyViolation;

					// Recurse into values
					const violation = await this.scan(value, seen);
					if (violation) return violation;
				}
			}
		}

		return null;
	}

	/**
	 * Checks a key against fuzzy matching rules.
	 * Short tokens use boundary-aware regex; long tokens use substring containment.
	 */
	private checkKeyFuzzy(key: string): string | null {
		const normalized = key.toLowerCase();

		// Skip safelisted keys entirely
		if (PiiScanner.KEY_SAFELIST.has(normalized)) return null;

		// Short token boundary matching (e.g., "id" in "patientId" but not "grid")
		for (const [token, pattern] of this.shortTokenBoundaryPatterns) {
			if (pattern.test(key)) {
				return `Forbidden Key (fuzzy): ${key} matches boundary pattern "${token}"`;
			}
		}

		// Long token substring matching (e.g., "name" in "firstName", "names")
		for (const token of this.longForbiddenTokens) {
			if (normalized.includes(token)) {
				return `Forbidden Key (fuzzy): ${key} contains restricted token "${token}"`;
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
