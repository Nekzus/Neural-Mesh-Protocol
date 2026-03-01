/**
 * NMP Professional PII Engine (The Shield V2)
 * Implements high-fidelity detection based on NIST and OWASP standards.
 */

export const PII_PATTERNS = {
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    CREDIT_CARD: /(?:\d[ -]*?){13,16}/g,
    IP_ADDRESS: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    PHONE: /\+?[0-9ext(). -]{7,}/g,
    // Keys that should never be exported in a JSON object
    FORBIDDEN_KEYS: /^(id|ssn|social_security|password|token|secret|address|phone|email|name|nombre|apellido|birth|nacimiento)$/i,
};

export type PiiRule = string | RegExp;

export class PiiScanner {
    private patterns: PiiRule[];

    constructor(patterns: PiiRule[] = []) {
        this.patterns = patterns;
    }

    /**
     * Scans any input (string, object, array) for PII violations.
     * Returns the pattern that triggered the violation, or null if safe.
     */
    public scan(input: unknown, seen = new WeakSet<object>()): string | null {
        if (input === null || input === undefined) return null;

        // 1. String Scan (Direct Regex/String check)
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
                for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
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
        for (const pattern of this.patterns) {
            if (typeof pattern === "string") {
                if (text.toLowerCase().includes(pattern.toLowerCase())) {
                    return pattern;
                }
            } else if (pattern instanceof RegExp) {
                // Reset lastIndex for global regexes
                if (pattern.global) pattern.lastIndex = 0;
                if (pattern.test(text)) {
                    return pattern.source;
                }
            }
        }
        return null;
    }
}
