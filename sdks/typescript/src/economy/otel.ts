// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import type { Histogram } from "@opentelemetry/api";
import { metrics } from "@opentelemetry/api";
import { log } from "../utils/logger.js";

/** SDK identifier for the OTel Meter */
const METER_NAME = "@nekzus/liop";
const METER_VERSION = "1.2.0-alpha.9";

/**
 * gen_ai.client.token.usage — Recommended explicit bucket boundaries.
 * Source: OpenTelemetry Generative AI Semantic Conventions (experimental).
 */
const TOKEN_USAGE_BUCKETS = [
	1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
	16777216, 67108864,
];

/**
 * gen_ai.client.operation.duration — Recommended bucket boundaries (seconds).
 * Source: OpenTelemetry Generative AI Semantic Conventions.
 */
const DURATION_BUCKETS = [
	0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48,
	40.96, 81.92,
];

/**
 * LiopOTelBridge — OpenTelemetry gen_ai.* metric emitter.
 *
 * Pattern: Library Instrumentation (uses global MeterProvider only).
 * Per official OTel JS documentation:
 * - Libraries MUST NOT create their own MeterProvider
 * - Libraries SHOULD use metrics.getMeter() from the global API
 * - If no MeterProvider is registered by the application, all operations are NoOp
 *   with zero runtime overhead (confirmed by OTel JS source: NoopMeterProvider)
 *
 * Follows OpenTelemetry Generative AI Semantic Conventions (Development status).
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export class LiopOTelBridge {
	private tokenUsage: Histogram;
	private operationDuration: Histogram;
	private active = false;

	constructor() {
		try {
			const meter = metrics.getMeter(METER_NAME, METER_VERSION);

			this.tokenUsage = meter.createHistogram("gen_ai.client.token.usage", {
				description: "Number of tokens used in LIOP Logic-on-Origin operations",
				unit: "{token}",
				advice: { explicitBucketBoundaries: TOKEN_USAGE_BUCKETS },
			});

			this.operationDuration = meter.createHistogram(
				"gen_ai.client.operation.duration",
				{
					description: "Duration of LIOP operations",
					unit: "s",
					advice: { explicitBucketBoundaries: DURATION_BUCKETS },
				},
			);

			this.active = true;
			log.debug("[LIOP-OTel] gen_ai.* metrics bridge initialized");
		} catch (err: unknown) {
			// OTel API failed to load — degrade gracefully without affecting protocol
			log.debug(
				`[LIOP-OTel] Bridge disabled: ${err instanceof Error ? err.message : String(err)}`,
			);
			const noopHistogram = {
				record: () => {},
			} as unknown as Histogram;
			this.tokenUsage = noopHistogram;
			this.operationDuration = noopHistogram;
		}
	}

	/**
	 * Record token usage with gen_ai.* standard attributes.
	 *
	 * @param tokens - Number of tokens consumed
	 * @param tokenType - "input" or "output" (gen_ai.token.type)
	 * @param operationName - gen_ai.operation.name (e.g., "execute_tool", "chat")
	 * @param toolName - Optional LIOP-specific tool name for attribution
	 */
	recordTokens(
		tokens: number,
		tokenType: "input" | "output",
		operationName: string,
		toolName?: string,
	): void {
		this.tokenUsage.record(tokens, {
			"gen_ai.system": "liop",
			"gen_ai.operation.name": operationName,
			"gen_ai.token.type": tokenType,
			"gen_ai.request.model": "liop-mesh",
			...(toolName ? { "liop.tool.name": toolName } : {}),
		});
	}

	/**
	 * Record operation duration with gen_ai.* standard attributes.
	 *
	 * @param durationMs - Duration in milliseconds (converted to seconds for OTel)
	 * @param operationName - gen_ai.operation.name
	 * @param error - Optional error type string if the operation failed
	 */
	recordDuration(
		durationMs: number,
		operationName: string,
		error?: string,
	): void {
		this.operationDuration.record(durationMs / 1000, {
			"gen_ai.system": "liop",
			"gen_ai.operation.name": operationName,
			...(error ? { "error.type": error } : {}),
		});
	}

	/** Whether the OTel bridge is actively connected to a MeterProvider */
	isActive(): boolean {
		return this.active;
	}
}
