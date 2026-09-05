// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP UX: compact tool descriptions are ENABLED by default to optimize
 * token consumption for LLM clients (e.g. Claude Desktop).
 *
 * Set LIOP_MCP_COMPACT_TOOL_DESCRIPTIONS=0 to restore verbose descriptions.
 * Full LIOP payload format remains in prompts/get → liop_blind_analyst.
 */
export function mcpCompactToolDescriptions(): boolean {
	const v =
		process.env.LIOP_MCP_COMPACT_TOOL_DESCRIPTIONS?.toLowerCase().trim();
	if (v === "0" || v === "false" || v === "no") return false;
	return true;
}

/**
 * Removes SDK-appended LIOP specification blocks from a registered tool description.
 */
export function stripVerboseLiopToolDescription(description: string): string {
	let d = description;
	const markers = [
		"\n\n[LIOP-PROTO-V1:",
		"\r\n\r\n[LIOP-PROTO-V1:",
		"\n[LIOP-PROTO-V1:", // rare
	];
	for (const m of markers) {
		const i = d.indexOf(m);
		if (i !== -1) {
			d = d.slice(0, i);
			break;
		}
	}
	return d.trimEnd();
}
