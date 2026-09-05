// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { generateSystemInstructions } from "./adapters.js";

describe("Cross-AI Prompt Adapters (Phase 92)", () => {
	it("should generate Claude optimized instructions using XML standards", () => {
		const result = generateSystemInstructions("claude");
		expect(result).toContain("<liop_logic>");
		expect(result).toContain("CLAUDE-XML PREFERRED");
		expect(result).not.toContain('"logic_blob"');
	});

	it("should generate OpenAI optimized instructions using JSON schemas", () => {
		const result = generateSystemInstructions("openai");
		expect(result).toContain('"logic_blob"');
		expect(result).toContain("JSON PARSING PREFERRED");
		expect(result).not.toContain("<liop_logic>");
	});

	it("should generate Gemini optimized instructions using JSON schemas", () => {
		const result = generateSystemInstructions("gemini");
		expect(result).toContain('"logic_blob"');
		expect(result).toContain("JSON PARSING PREFERRED");
		expect(result).not.toContain("<liop_logic>");
	});

	it("should include core paradigm instructions for all providers", () => {
		const providers = ["claude", "openai", "gemini"] as const;
		for (const provider of providers) {
			const result = generateSystemInstructions(provider);
			expect(result).toContain(
				"[LIOP-PROTO-V1: LOGIC-ON-ORIGIN SPECIFICATION]",
			);
			expect(result).toContain("CORE PARADIGM");
			expect(result).toContain("EXECUTION RULES");
			expect(result).toContain("DIFFERENTIAL PRIVACY (DP) MECHANISM");
			expect(result).toContain("COUNT / LENGTH queries");
			expect(result).toContain("AVERAGE queries");
			expect(result).toContain("SUM / OTHER queries");
			expect(result).toContain("SANDBOX RUNTIME RESTRICTIONS & WORKAROUNDS");
			expect(result).toContain("Date is poisoned");
			expect(result).toContain("K-Anonymity constraints");
		}
	});
});
