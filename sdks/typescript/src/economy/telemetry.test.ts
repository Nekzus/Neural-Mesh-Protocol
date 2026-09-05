// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { TokenTelemetryEngine } from "./telemetry.js";

describe("TokenTelemetryEngine", () => {
	afterEach(() => {
		TokenTelemetryEngine.destroy();
	});

	it("should return a singleton instance", () => {
		const a = TokenTelemetryEngine.getInstance();
		const b = TokenTelemetryEngine.getInstance();
		expect(a).toBe(b);
	});

	it("should record operations and produce a report", () => {
		const engine = TokenTelemetryEngine.getInstance();
		engine.record({
			type: "tools_list",
			method: "tools/list",
			estimatedInputTokens: 500,
			estimatedOutputTokens: 0,
		});
		engine.record({
			type: "tool_call",
			method: "tools/call",
			estimatedInputTokens: 100,
			estimatedOutputTokens: 200,
		});

		const report = engine.getReport();
		expect(report.operations).toHaveLength(2);
		expect(report.totalInputTokens).toBe(600);
		expect(report.totalOutputTokens).toBe(200);
		expect(report.sessionId).toBeTruthy();
	});

	it("should estimate tokens using active estimator", () => {
		const engine = TokenTelemetryEngine.getInstance();
		const text = "The quick brown fox jumps over the lazy dog";
		expect(engine.estimateTokens(text)).toBeGreaterThan(0);
		expect(engine.estimateTokens("")).toBe(0);
	});

	it("should count tokens consistently across calls", () => {
		const engine = TokenTelemetryEngine.getInstance();
		const text = "Hello world! Testing LIOP protocol token telemetry.";
		const c1 = engine.estimateTokens(text);
		const c2 = engine.estimateTokens(text);
		expect(c1).toBe(c2);
		expect(c1).toBeGreaterThan(0);
	});

	it("should format a non-empty status block", () => {
		const engine = TokenTelemetryEngine.getInstance();
		engine.record({
			type: "tools_list",
			method: "tools/list",
			estimatedInputTokens: 1200,
			estimatedOutputTokens: 0,
		});

		const block = engine.formatStatusBlock();
		expect(block).toContain("Token Economy:");
		expect(block).toContain("Operations: 1");
		expect(block).toContain("Total:");
	});

	it("should return empty string for status block with no operations", () => {
		const engine = TokenTelemetryEngine.getInstance();
		expect(engine.formatStatusBlock()).toBe("");
	});

	it("should reset operations cleanly", () => {
		const engine = TokenTelemetryEngine.getInstance();
		engine.record({
			type: "tool_call",
			method: "tools/call",
			estimatedInputTokens: 50,
			estimatedOutputTokens: 100,
		});
		engine.reset();

		const report = engine.getReport();
		expect(report.operations).toHaveLength(0);
		expect(report.totalInputTokens).toBe(0);
	});

	it("should isolate instances after destroy", () => {
		const first = TokenTelemetryEngine.getInstance();
		first.record({
			type: "tools_list",
			method: "tools/list",
			estimatedInputTokens: 999,
			estimatedOutputTokens: 0,
		});

		TokenTelemetryEngine.destroy();
		const second = TokenTelemetryEngine.getInstance();

		expect(second).not.toBe(first);
		expect(second.getReport().operations).toHaveLength(0);
	});
});
