// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Prometheus Metrics Registry (Phase Beta-3)
 * Lightweight, zero-dependency, high-performance metrics collector
 * complying with Prometheus and OpenMetrics exposition format.
 */

export type MetricLabels = Record<string, string | number>;

export interface MetricDefinition {
	name: string;
	help: string;
	type: "counter" | "gauge" | "histogram";
	buckets?: number[];
}

function formatLabels(labels?: MetricLabels): string {
	if (!labels || Object.keys(labels).length === 0) {
		return "";
	}
	const entries = Object.entries(labels)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
	return `{${entries.join(",")}}`;
}

function labelsToKey(labels?: MetricLabels): string {
	if (!labels) return "";
	return Object.entries(labels)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}:${v}`)
		.join("|");
}

export class Counter {
	private values = new Map<string, { value: number; labels?: MetricLabels }>();

	constructor(
		public readonly name: string,
		public readonly help: string,
	) {}

	inc(labels?: MetricLabels, value = 1): void {
		if (value < 0) {
			throw new Error("Counter increments must be non-negative");
		}
		const key = labelsToKey(labels);
		const current = this.values.get(key) || { value: 0, labels };
		current.value += value;
		this.values.set(key, current);
	}

	get(labels?: MetricLabels): number {
		const key = labelsToKey(labels);
		return this.values.get(key)?.value || 0;
	}

	reset(): void {
		this.values.clear();
	}

	toPrometheus(): string[] {
		const lines: string[] = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} counter`,
		];
		if (this.values.size === 0) {
			lines.push(`${this.name} 0`);
			return lines;
		}
		for (const entry of this.values.values()) {
			lines.push(`${this.name}${formatLabels(entry.labels)} ${entry.value}`);
		}
		return lines;
	}
}

export class Gauge {
	private values = new Map<string, { value: number; labels?: MetricLabels }>();

	constructor(
		public readonly name: string,
		public readonly help: string,
	) {}

	set(labelsOrValue: MetricLabels | number, maybeValue?: number): void {
		if (typeof labelsOrValue === "number") {
			this.values.set("", { value: labelsOrValue });
			return;
		}
		const labels = labelsOrValue;
		const val = typeof maybeValue === "number" ? maybeValue : 0;
		const key = labelsToKey(labels);
		this.values.set(key, { value: val, labels });
	}

	inc(labels?: MetricLabels, value = 1): void {
		const key = labelsToKey(labels);
		const current = this.values.get(key) || { value: 0, labels };
		current.value += value;
		this.values.set(key, current);
	}

	dec(labels?: MetricLabels, value = 1): void {
		const key = labelsToKey(labels);
		const current = this.values.get(key) || { value: 0, labels };
		current.value -= value;
		this.values.set(key, current);
	}

	get(labels?: MetricLabels): number {
		const key = labelsToKey(labels);
		return this.values.get(key)?.value || 0;
	}

	reset(): void {
		this.values.clear();
	}

	toPrometheus(): string[] {
		const lines: string[] = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} gauge`,
		];
		if (this.values.size === 0) {
			lines.push(`${this.name} 0`);
			return lines;
		}
		for (const entry of this.values.values()) {
			lines.push(`${this.name}${formatLabels(entry.labels)} ${entry.value}`);
		}
		return lines;
	}
}

export class Histogram {
	public readonly buckets: number[];
	private observations = new Map<
		string,
		{
			count: number;
			sum: number;
			bucketCounts: Map<number, number>;
			labels?: MetricLabels;
		}
	>();

	constructor(
		public readonly name: string,
		public readonly help: string,
		buckets: number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
	) {
		this.buckets = [...buckets].sort((a, b) => a - b);
	}

	observe(labelsOrValue: MetricLabels | number, maybeValue?: number): void {
		let labels: MetricLabels | undefined;
		let val: number;

		if (typeof labelsOrValue === "number") {
			val = labelsOrValue;
		} else {
			labels = labelsOrValue;
			val = typeof maybeValue === "number" ? maybeValue : 0;
		}

		const key = labelsToKey(labels);
		let state = this.observations.get(key);
		if (!state) {
			state = {
				count: 0,
				sum: 0,
				bucketCounts: new Map(this.buckets.map((b) => [b, 0])),
				labels,
			};
			this.observations.set(key, state);
		}

		state.count += 1;
		state.sum += val;

		for (const bound of this.buckets) {
			if (val <= bound) {
				const cur = state.bucketCounts.get(bound) || 0;
				state.bucketCounts.set(bound, cur + 1);
			}
		}
	}

	reset(): void {
		this.observations.clear();
	}

	toPrometheus(): string[] {
		const lines: string[] = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} histogram`,
		];
		if (this.observations.size === 0) {
			lines.push(`${this.name}_count 0`);
			lines.push(`${this.name}_sum 0`);
			return lines;
		}

		for (const state of this.observations.values()) {
			const baseLabels = state.labels || {};
			for (const bound of this.buckets) {
				const bucketLabels = { ...baseLabels, le: String(bound) };
				lines.push(
					`${this.name}_bucket${formatLabels(bucketLabels)} ${state.bucketCounts.get(bound) || 0}`,
				);
			}
			const infLabels = { ...baseLabels, le: "+Inf" };
			lines.push(
				`${this.name}_bucket${formatLabels(infLabels)} ${state.count}`,
			);
			lines.push(`${this.name}_sum${formatLabels(baseLabels)} ${state.sum}`);
			lines.push(
				`${this.name}_count${formatLabels(baseLabels)} ${state.count}`,
			);
		}
		return lines;
	}
}

export class MetricsRegistry {
	private counters = new Map<string, Counter>();
	private gauges = new Map<string, Gauge>();
	private histograms = new Map<string, Histogram>();

	counter(name: string, help: string): Counter {
		let c = this.counters.get(name);
		if (!c) {
			c = new Counter(name, help);
			this.counters.set(name, c);
		}
		return c;
	}

	gauge(name: string, help: string): Gauge {
		let g = this.gauges.get(name);
		if (!g) {
			g = new Gauge(name, help);
			this.gauges.set(name, g);
		}
		return g;
	}

	histogram(name: string, help: string, buckets?: number[]): Histogram {
		let h = this.histograms.get(name);
		if (!h) {
			h = new Histogram(name, help, buckets);
			this.histograms.set(name, h);
		}
		return h;
	}

	collectProcessMetrics(): void {
		const uptime = this.gauge(
			"liop_process_uptime_seconds",
			"Process uptime in seconds",
		);
		uptime.set(Math.floor(process.uptime()));

		if (typeof process.memoryUsage === "function") {
			const mem = process.memoryUsage();
			const rss = this.gauge(
				"liop_process_memory_rss_bytes",
				"Resident set size memory in bytes",
			);
			rss.set(mem.rss);

			const heapUsed = this.gauge(
				"liop_process_memory_heap_used_bytes",
				"Heap memory used in bytes",
			);
			heapUsed.set(mem.heapUsed);
		}
	}

	exportPrometheusText(): string {
		this.collectProcessMetrics();

		const lines: string[] = [];
		for (const c of this.counters.values()) {
			lines.push(...c.toPrometheus());
		}
		for (const g of this.gauges.values()) {
			lines.push(...g.toPrometheus());
		}
		for (const h of this.histograms.values()) {
			lines.push(...h.toPrometheus());
		}
		lines.push(""); // Trailing newline
		return lines.join("\n");
	}

	resetAll(): void {
		for (const c of this.counters.values()) c.reset();
		for (const g of this.gauges.values()) g.reset();
		for (const h of this.histograms.values()) h.reset();
	}
}

// ── Global Standard Protocol Metrics Instance ──────────────────────────────────

export const protocolMetrics = new MetricsRegistry();

export const toolCallsTotal = protocolMetrics.counter(
	"liop_tool_calls_total",
	"Total number of tool logic-injection executions",
);

export const fuelConsumed = protocolMetrics.histogram(
	"liop_fuel_consumed_total",
	"Deterministic fuel units consumed by injected logic",
	[100, 500, 1000, 2500, 5000, 10000, 50000, 100000],
);

export const meshPeersConnected = protocolMetrics.gauge(
	"liop_mesh_peers_connected",
	"Active peer connections in the P2P mesh",
);

export const manifestCacheSize = protocolMetrics.gauge(
	"liop_manifest_cache_size",
	"Number of verified remote tool manifests in cache",
);

export const egressBlocksTotal = protocolMetrics.counter(
	"liop_egress_blocks_total",
	"Total number of outputs blocked by Egress Shield",
);

export const zkVerificationDurationMs = protocolMetrics.histogram(
	"liop_zk_verification_duration_ms",
	"Duration of ZK-Receipt and HMAC cryptographic attestation in ms",
	[1, 2, 5, 10, 25, 50, 100],
);
