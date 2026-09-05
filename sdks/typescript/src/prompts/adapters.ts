// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Cross-AI Prompt Adapters (Fase 92)
 *
 * Normalizes system instructions for different LLM providers (Claude, OpenAI, Gemini)
 * to ensure they understand how to generate "Logic-on-Origin" WASM-compatible payload structures.
 */

export type AIProvider = "claude" | "openai" | "gemini";

export interface PromptConfig {
	xmlStandard: boolean;
	jsonSchemaPreferred: boolean;
}

const PROVIDER_CONFIGS: Record<AIProvider, PromptConfig> = {
	claude: { xmlStandard: true, jsonSchemaPreferred: false },
	openai: { xmlStandard: false, jsonSchemaPreferred: true },
	gemini: { xmlStandard: false, jsonSchemaPreferred: true },
};

/**
 * Generates specific System Prompts optimized for the provided AI.
 * This instructs the LLM on how to bypass Context-Pulling and use Logic-Injection (Zero-Shot).
 */
export function generateSystemInstructions(provider: AIProvider): string {
	const config = PROVIDER_CONFIGS[provider];

	let instructions = `[LIOP-PROTO-V1: LOGIC-ON-ORIGIN SPECIFICATION]
You are interacting with a Logic-Injection-on-Origin Protocol (LIOP) Mesh Network.
Unlike standard MCP where you pull context to evaluate it remotely, in LIOP you WRITE code that executes on the data's origin.

### CORE PARADIGM
When you call a tool or resource, you MUST provide a payload that represents secure sandboxed logic to be executed on the remote Node.
The node will execute your logic securely on the raw secure data, and return only the RESULT, avoiding PII data egress.

### EXECUTION RULES
1. Provide a self-contained JavaScript syntax block that we will compile to WASM-Sandboxed logic.
2. Rely only on standard ECMA script features (No Node.js polyfills).
3. The logic must end by returning the calculated insights, not the raw data.

### DIFFERENTIAL PRIVACY (DP) MECHANISM (Laplace Mechanism)
To prevent database reconstruction and inference attacks, numeric query outputs are processed by a Laplace DP engine:
- COUNT / LENGTH queries: To get EXACT integer values without noise, you MUST name return keys containing 'count', 'length', 'size', 'num', 'positive', 'negative', or starting with 'total_' or 'num_' (e.g. 'total_tx', 'credits_count'). This forces sensitivity=1.0, rounds values, and clamps to non-negative values.
- AVERAGE queries: Return keys containing 'avg', 'mean', or 'average' scale down noise automatically by dividing global sensitivity by the dataset size (sensitivity / n).
- SUM / OTHER queries: Return keys without these semantic names receive full Laplace noise based on the global node sensitivity (which can be up to 100,000 in Bank nodes to protect raw balances). Do NOT attempt to bypass this by renaming sum fields to count fields, as it violates protocol integrity.

### SANDBOX RUNTIME RESTRICTIONS & WORKAROUNDS
- Date is poisoned: The 'Date' class/constructor is undefined (calling 'new Date()', 'Date.now()', or 'Date.parse()' will crash the execution).
  - Workaround: Perform chronological sorting and comparisons lexicographically on ISO 8601 string dates (e.g. record.date >= '2024-01-01').
- Poisoned globals: eval, Function, setTimeout, setInterval, Buffer, ArrayBuffer, and TypedArrays are undefined.
- Frozen prototypes: Modifications to Object.prototype, Array.prototype, etc., are blocked.
- K-Anonymity constraints: Small datasets (< 10 records) limit outputs to max 3 scalar keys with NO nesting. Datasets with >= 10 records limit outputs to max 10 fields.
`;

	if (config.xmlStandard) {
		instructions += `
### PAYLOAD FORMATTING (CLAUDE-XML PREFERRED)
You must wrap your logic precisely within <liop_logic> tags.
Example:
<liop_logic>
const records = await liop.readResource("liop://vault/patients");
const filtered = records.filter(r => r.disease === "Hypertension");
return { alert: "High risk demographic", targetCount: filtered.length };
</liop_logic>
`;
	} else if (config.jsonSchemaPreferred) {
		instructions += `
### PAYLOAD FORMATTING (JSON PARSING PREFERRED)
You must provide your logic strictly within a JSON string key called \`"logic_blob"\` inside your tool call parameters.
Example:
{
  "target": "liop://vault/patients",
  "logic_blob": "const records = await liop.readResource(args.target); return { targetCount: records.filter(r => r.disease === 'Hypertension').length };"
}
`;
	}

	return instructions;
}
