// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import {
	createSyncTokenEstimator,
	createTokenEstimator,
	type TokenEstimator,
} from "./estimator.js";
import { LiopOTelBridge } from "./otel.js";

/** Single MCP operation token footprint */
export interface TokenOperationMetric {
	readonly type:
		| "tools_list"
		| "tool_call"
		| "resource_read"
		| "resource_list"
		| "prompt_get"
		| "prompt_list"
		| "diagnostic";
	readonly method: string;
	readonly estimatedInputTokens: number;
	readonly estimatedOutputTokens: number;
	readonly timestamp: number;
	readonly toolName?: string;
	readonly peerId?: string;
	readonly durationMs?: number;
}

/** Session-level aggregate report */
export interface TokenSessionReport {
	readonly sessionId: string;
	readonly operations: ReadonlyArray<TokenOperationMetric>;
	readonly totalInputTokens: number;
	readonly totalOutputTokens: number;
	readonly estimatorName: string;
	readonly sessionUptimeMs: number;
}

/** Per-tool aggregate breakdown */
export interface ToolTokenBreakdown {
	readonly input: number;
	readonly output: number;
	readonly calls: number;
	readonly avgDurationMs: number;
}

/**
 * Maps operation types to OTel gen_ai.operation.name values.
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
const OTEL_OPERATION_MAP: Record<TokenOperationMetric["type"], string> = {
	tools_list: "chat",
	tool_call: "execute_tool",
	resource_read: "chat",
	resource_list: "chat",
	prompt_get: "chat",
	prompt_list: "chat",
	diagnostic: "chat",
};

/**
 * TokenTelemetryEngine — Full-spectrum observational singleton for token cost measurement.
 *
 * Design principles:
 * - Pure observer pattern: NEVER mutates MCP payloads or protocol flow.
 * - Real tokenization: o200k_base BPE via gpt-tokenizer (async init, sync counting).
 * - OTel gen_ai.* emission: standard metrics via @opentelemetry/api (NoOp if no provider).
 * - Error isolation: telemetry failures never propagate to protocol operations.
 */
export class TokenTelemetryEngine {
	private static instance: TokenTelemetryEngine | null = null;
	private operations: TokenOperationMetric[] = [];
	private readonly sessionId: string;
	private readonly startedAt: number;
	private estimator: TokenEstimator;
	private otelBridge: LiopOTelBridge;

	private constructor() {
		this.sessionId = crypto.randomUUID();
		this.startedAt = Date.now();
		// Start with sync heuristic estimator (available immediately)
		this.estimator = createSyncTokenEstimator();
		this.otelBridge = new LiopOTelBridge();
		// Upgrade to real tokenizer asynchronously
		this.initRealEstimator();
	}

	/** Async upgrade from heuristic to real BPE tokenizer */
	private initRealEstimator(): void {
		createTokenEstimator()
			.then((real) => {
				this.estimator = real;
			})
			.catch(() => {
				// Keep heuristic fallback — already assigned in constructor
			});
	}

	static getInstance(): TokenTelemetryEngine {
		if (!TokenTelemetryEngine.instance) {
			TokenTelemetryEngine.instance = new TokenTelemetryEngine();
		}
		return TokenTelemetryEngine.instance;
	}

	/**
	 * Count tokens in a string using the active estimator.
	 * Delegates to o200k_base BPE tokenizer (or heuristic fallback).
	 */
	countTokens(content: string): number {
		try {
			return this.estimator.countTokens(content);
		} catch {
			// Fallback: never let counting failures break protocol flow
			return Math.ceil(content.length / 4);
		}
	}

	/**
	 * Record a single MCP operation's token footprint.
	 * Emits both internal metrics and OTel gen_ai.* histograms.
	 */
	record(metric: Omit<TokenOperationMetric, "timestamp">): void {
		const fullMetric: TokenOperationMetric = {
			...metric,
			timestamp: Date.now(),
		};
		this.operations.push(fullMetric);

		// Emit to OTel bridge (NoOp if no MeterProvider configured)
		try {
			const otelOp = OTEL_OPERATION_MAP[metric.type] || "chat";

			if (metric.estimatedInputTokens > 0) {
				this.otelBridge.recordTokens(
					metric.estimatedInputTokens,
					"input",
					otelOp,
					metric.toolName,
				);
			}
			if (metric.estimatedOutputTokens > 0) {
				this.otelBridge.recordTokens(
					metric.estimatedOutputTokens,
					"output",
					otelOp,
					metric.toolName,
				);
			}
			if (metric.durationMs !== undefined) {
				this.otelBridge.recordDuration(metric.durationMs, otelOp);
			}
		} catch {
			// OTel emission failure must never affect protocol operations
		}
	}

	/**
	 * @deprecated Use countTokens() instead. Kept for backward compatibility.
	 */
	estimateTokens(content: string): number {
		return this.countTokens(content);
	}

	/** Generate the full session report */
	getReport(): TokenSessionReport {
		return {
			sessionId: this.sessionId,
			operations: [...this.operations],
			totalInputTokens: this.operations.reduce(
				(sum, op) => sum + op.estimatedInputTokens,
				0,
			),
			totalOutputTokens: this.operations.reduce(
				(sum, op) => sum + op.estimatedOutputTokens,
				0,
			),
			estimatorName: this.estimator.name,
			sessionUptimeMs: Date.now() - this.startedAt,
		};
	}

	/** Get per-tool token breakdown for diagnostic display */
	getPerToolReport(): Map<string, ToolTokenBreakdown> {
		const breakdown = new Map<string, ToolTokenBreakdown>();

		for (const op of this.operations) {
			const key = op.toolName || op.method;
			const existing = breakdown.get(key) || {
				input: 0,
				output: 0,
				calls: 0,
				avgDurationMs: 0,
			};

			const totalDuration =
				existing.avgDurationMs * existing.calls + (op.durationMs || 0);
			const newCalls = existing.calls + 1;

			breakdown.set(key, {
				input: existing.input + op.estimatedInputTokens,
				output: existing.output + op.estimatedOutputTokens,
				calls: newCalls,
				avgDurationMs: newCalls > 0 ? totalDuration / newCalls : 0,
			});
		}

		return breakdown;
	}

	/**
	 * Format a rich, human-readable summary block for LiopMeshStatus diagnostic.
	 * Returns empty string when no operations have been recorded.
	 */
	formatStatusBlock(): string {
		const report = this.getReport();
		if (report.operations.length === 0) return "";

		const uptimeStr = this.formatUptime(report.sessionUptimeMs);
		const totalCombined = report.totalInputTokens + report.totalOutputTokens;

		// Aggregate operations by type
		const byType = new Map<
			string,
			{ count: number; input: number; output: number }
		>();
		for (const op of report.operations) {
			const key = op.type;
			const existing = byType.get(key) || {
				count: 0,
				input: 0,
				output: 0,
			};
			byType.set(key, {
				count: existing.count + 1,
				input: existing.input + op.estimatedInputTokens,
				output: existing.output + op.estimatedOutputTokens,
			});
		}

		// Build type breakdown lines
		const typeEntries = Array.from(byType.entries());
		const typeLines = typeEntries.map(([type, data], idx) => {
			const prefix = idx === typeEntries.length - 1 ? "│  └─" : "│  ├─";
			const outputPart =
				data.output > 0 ? ` / ${data.output.toLocaleString()} out` : "";
			return `${prefix} ${type} ×${data.count} → ${data.input.toLocaleString()} in${outputPart}`;
		});

		// Build per-tool breakdown
		const toolReport = this.getPerToolReport();
		const toolEntries = Array.from(toolReport.entries()).filter(
			([key]) => key !== "tools/list" && key !== "LiopMeshStatus",
		);

		const toolLines: string[] = [];
		if (toolEntries.length > 0) {
			toolLines.push("├─ By Tool:");
			toolEntries.forEach(([name, data], idx) => {
				const prefix = idx === toolEntries.length - 1 ? "│  └─" : "│  ├─";
				const outputPart =
					data.output > 0 ? ` / ${data.output.toLocaleString()} out` : "";
				const durationPart =
					data.avgDurationMs > 0 ? ` ~${Math.round(data.avgDurationMs)}ms` : "";
				toolLines.push(
					`${prefix} ${name}: ${data.input.toLocaleString()} in${outputPart} (×${data.calls})${durationPart}`,
				);
			});
		}

		// Calculate average latency across all timed operations
		const timedOps = report.operations.filter(
			(op) => op.durationMs !== undefined,
		);
		const avgLatency =
			timedOps.length > 0
				? Math.round(
						timedOps.reduce((sum, op) => sum + (op.durationMs || 0), 0) /
							timedOps.length,
					)
				: 0;

		const otelStatus = this.otelBridge.isActive()
			? "gen_ai.client.token.usage → active"
			: "disabled";

		const lines = [
			"\nToken Economy:",
			`├─ Session: ${report.sessionId.slice(0, 8)} (${uptimeStr})`,
			`├─ Estimator: ${report.estimatorName}`,
			`├─ Operations: ${report.operations.length}`,
			...typeLines,
			`├─ Total: ${report.totalInputTokens.toLocaleString()} in / ${report.totalOutputTokens.toLocaleString()} out (${totalCombined.toLocaleString()} combined)`,
			...toolLines,
			...(avgLatency > 0 ? [`├─ Avg Latency: ${avgLatency}ms`] : []),
			`└─ OTel: ${otelStatus}`,
		];

		return lines.join("\n");
	}

	/** Format milliseconds into human-readable uptime string */
	private formatUptime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m`;
	}

	/** Reset all recorded metrics (used in tests) */
	reset(): void {
		this.operations = [];
	}

	/** Destroy the singleton (used in tests to guarantee isolation) */
	static destroy(): void {
		TokenTelemetryEngine.instance = null;
	}
}
