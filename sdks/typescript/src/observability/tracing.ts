// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP OpenTelemetry Distributed Tracing (Phase Beta-3)
 * W3C TraceContext compliant distributed tracer for gRPC & MCP transports.
 * Spec: https://www.w3.org/TR/trace-context/
 */

import * as crypto from "node:crypto";

export interface SpanContext {
	traceId: string;
	spanId: string;
	sampled: boolean;
}

export interface LiopSpan {
	readonly name: string;
	readonly context: SpanContext;
	readonly startTime: number;
	endTime?: number;
	attributes: Record<string, string | number | boolean>;
	status: "OK" | "ERROR";
	error?: string;
	setAttribute(key: string, value: string | number | boolean): LiopSpan;
	recordException(error: Error | string): LiopSpan;
	end(): void;
}

const TRACEPARENT_REGEX =
	/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export class LiopTracer {
	public static generateTraceId(): string {
		let id: string;
		do {
			id = crypto.randomBytes(16).toString("hex");
		} while (id === "0".repeat(32));
		return id;
	}

	public static generateSpanId(): string {
		let id: string;
		do {
			id = crypto.randomBytes(8).toString("hex");
		} while (id === "0".repeat(16));
		return id;
	}

	public static formatTraceparent(
		traceId: string,
		spanId: string,
		sampled = true,
	): string {
		const flags = sampled ? "01" : "00";
		return `00-${traceId}-${spanId}-${flags}`;
	}

	public static parseTraceparent(header?: string | null): SpanContext | null {
		if (!header || typeof header !== "string") {
			return null;
		}
		const trimmed = header.trim();
		const match = TRACEPARENT_REGEX.exec(trimmed);
		if (!match) {
			return null;
		}

		const [, version, traceId, spanId, flags] = match;
		// Version 00 cannot have all-zeros traceId or spanId
		if (version === "00") {
			if (traceId === "0".repeat(32) || spanId === "0".repeat(16)) {
				return null;
			}
		}

		const sampled = (Number.parseInt(flags, 16) & 0x01) === 1;
		return {
			traceId,
			spanId,
			sampled,
		};
	}

	public static injectTraceparent(
		carrier: Record<string, string | string[] | undefined>,
		context: SpanContext,
	): void {
		carrier.traceparent = LiopTracer.formatTraceparent(
			context.traceId,
			context.spanId,
			context.sampled,
		);
	}

	public static extractTraceparent(
		carrier: Record<string, string | string[] | undefined>,
	): SpanContext | null {
		const val = carrier.traceparent || carrier.Traceparent;
		if (Array.isArray(val)) {
			return LiopTracer.parseTraceparent(val[0]);
		}
		return LiopTracer.parseTraceparent(val);
	}

	public startSpan(
		name: string,
		parent?: SpanContext | null,
		attributes: Record<string, string | number | boolean> = {},
	): LiopSpan {
		const traceId = parent?.traceId || LiopTracer.generateTraceId();
		const spanId = LiopTracer.generateSpanId();
		const sampled = parent ? parent.sampled : true;

		const context: SpanContext = {
			traceId,
			spanId,
			sampled,
		};

		const span: LiopSpan = {
			name,
			context,
			startTime: Date.now(),
			attributes: { ...attributes },
			status: "OK",
			setAttribute(key, value) {
				this.attributes[key] = value;
				return this;
			},
			recordException(err) {
				this.status = "ERROR";
				this.error = typeof err === "string" ? err : err.message;
				return this;
			},
			end() {
				this.endTime = Date.now();
			},
		};

		return span;
	}
}

export const defaultTracer = new LiopTracer();
