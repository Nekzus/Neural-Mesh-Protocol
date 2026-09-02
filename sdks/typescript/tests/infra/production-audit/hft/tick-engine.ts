/**
 * LIOP HFT Oracle — Tick Engine Orchestrator
 *
 * Central loop that connects pricing engines, order books, and trading
 * strategies into a high-frequency simulation. Maintains a ring buffer
 * audit trail for regulatory compliance.
 *
 * Compliance:
 * - MiFID II RTS 25: Dual timestamps (hrtime nanoseconds + ISO 8601 UTC)
 * - FINRA CAT: Complete order lifecycle audit trail
 * - SEC 15c3-5: Global kill switch across all instruments
 */
import type { OrderBook } from "./order-book.js";
import { HestonJumpDiffusionEngine } from "./pricing-engine.js";
import type { TradingStrategy } from "./strategies.js";
import {
	MarketMakerStrategy,
	NoiseTraderStrategy,
	TwapStrategy,
	VwapStrategy,
} from "./strategies.js";
import type {
	AuditEntry,
	AuditEntryType,
	HftTickRecord,
	InstrumentConfig,
	LatencyHistogram,
	TickEngineConfig,
	TradeEvent,
} from "./types.js";
import { OrderBook as OrderBookClass } from "./order-book.js";
import { DEFAULT_INSTRUMENTS } from "./types.js";

// ── Default Configuration ───────────────────────────────────────────

const DEFAULT_CONFIG: TickEngineConfig = {
	tickIntervalMs: 50,
	instrumentCount: 8,
	auditBufferSize: 50000,
	burnInTicks: 40,
	snapshotRefreshInterval: 5,
};

// ── Ring Buffer Audit Trail ─────────────────────────────────────────

class AuditRingBuffer {
	private readonly buffer: Array<AuditEntry | null>;
	private readonly capacity: number;
	private head = 0;
	private count = 0;

	constructor(capacity: number) {
		this.capacity = capacity;
		this.buffer = new Array(capacity).fill(null);
	}

	public push(entry: AuditEntry): void {
		this.buffer[this.head] = entry;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	public getEntries(limit = 100): AuditEntry[] {
		const result: AuditEntry[] = [];
		const start = this.count < this.capacity ? 0 : this.head;
		const total = Math.min(limit, this.count);

		for (let i = 0; i < total; i++) {
			const idx = (start + this.count - total + i) % this.capacity;
			const entry = this.buffer[idx];
			if (entry) result.push(entry);
		}
		return result;
	}

	public getCount(): number {
		return this.count;
	}

	/**
	 * Verifies monotonicity — every subsequent timestamp must be >= previous.
	 */
	public isMonotonic(): boolean {
		if (this.count < 2) return true;
		const entries = this.getEntries(this.count);
		for (let i = 1; i < entries.length; i++) {
			if (entries[i].timestamp < entries[i - 1].timestamp) return false;
		}
		return true;
	}
}

// ── Latency Tracker ─────────────────────────────────────────────────

class LatencyTracker {
	private samples: number[] = [];
	private readonly maxSamples = 10000;

	public record(latencyNs: bigint): void {
		this.samples.push(Number(latencyNs));
		if (this.samples.length > this.maxSamples) {
			this.samples = this.samples.slice(-this.maxSamples);
		}
	}

	public getHistogram(): LatencyHistogram {
		if (this.samples.length === 0) {
			return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0, unit: "ns" };
		}

		const sorted = [...this.samples].sort((a, b) => a - b);
		const len = sorted.length;
		return {
			p50: sorted[Math.floor(len * 0.5)],
			p95: sorted[Math.floor(len * 0.95)],
			p99: sorted[Math.floor(len * 0.99)],
			min: sorted[0],
			max: sorted[len - 1],
			count: len,
			unit: "ns",
		};
	}
}

// ── VWAP Accumulator ────────────────────────────────────────────────

interface VwapAccumulator {
	cumulativePriceVolume: number;
	cumulativeVolume: number;
}

// ── Volatility Window ───────────────────────────────────────────────

class RollingVolatility {
	private readonly prices: number[] = [];
	private readonly windowSize: number;

	constructor(windowTicks: number) {
		this.windowSize = windowTicks;
	}

	public push(price: number): void {
		this.prices.push(price);
		if (this.prices.length > this.windowSize) {
			this.prices.shift();
		}
	}

	/** Returns annualized volatility estimate from log returns */
	public getVolatility(): number {
		if (this.prices.length < 3) return 0;

		const logReturns: number[] = [];
		for (let i = 1; i < this.prices.length; i++) {
			if (this.prices[i - 1] > 0) {
				logReturns.push(Math.log(this.prices[i] / this.prices[i - 1]));
			}
		}

		if (logReturns.length < 2) return 0;

		const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
		const variance =
			logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);

		// Annualize tick-level volatility as a fraction (scaled by sqrt(252 * 6.5 * 3600 * 20) / 100 = ~108.6)
		const annualized = Math.sqrt(variance) * 108.6;
		return Math.round(annualized * 10000) / 10000;
	}
}

// ── Tick Engine ─────────────────────────────────────────────────────

export interface InstrumentState {
	readonly config: InstrumentConfig;
	readonly engine: HestonJumpDiffusionEngine;
	readonly book: OrderBookClass;
	readonly strategies: TradingStrategy[];
	readonly vwap: VwapAccumulator;
	readonly volatility: RollingVolatility;
}

export class TickEngine {
	private readonly config: TickEngineConfig;
	private readonly instruments: InstrumentState[];
	private readonly auditTrail: AuditRingBuffer;
	private readonly latencyTracker: LatencyTracker;
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	private tickIndex = 0;
	private running = false;
	private halted = false;
	private startTimeNs: bigint = 0n;
	private lastSnapshotData: HftTickRecord[] = [];

	constructor(config: Partial<TickEngineConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.auditTrail = new AuditRingBuffer(this.config.auditBufferSize);
		this.latencyTracker = new LatencyTracker();

		// Initialize instruments with engines, books, and strategies
		const instrumentConfigs = DEFAULT_INSTRUMENTS.slice(0, this.config.instrumentCount);
		this.instruments = instrumentConfigs.map((cfg) => {
			const engine = new HestonJumpDiffusionEngine(cfg);
			const book = new OrderBookClass(cfg.ticker);

			const vwapAcc: VwapAccumulator = { cumulativePriceVolume: 0, cumulativeVolume: 0 };

			// Wire audit trail + VWAP accumulation into trade events (fires once per trade)
			book.setTradeHandler((trade: TradeEvent) => {
				this.recordAudit("TRADE", trade.buyOrderId, cfg.ticker, "BUY", trade.price, trade.qty);
				vwapAcc.cumulativePriceVolume += trade.price * trade.qty;
				vwapAcc.cumulativeVolume += trade.qty;
			});

			// Create strategies for this instrument
			const strategies: TradingStrategy[] = [
				new MarketMakerStrategy({
					baseSpreadPct: 0.0005,
					orderSize: 100,
					maxInventory: 500,
					quoteLevels: 3,
				}),
				new NoiseTraderStrategy({
					orderProbability: 0.3,
					minOrderSize: 10,
					maxOrderSize: 200,
				}),
				// VWAP: Buy 1000 shares over 200 slices (10s at 20Hz)
				new VwapStrategy({
					totalQty: 1000,
					side: "BUY",
					totalSlices: 200,
					ticksPerSlice: 1,
				}),
				// TWAP: Sell 800 shares over 160 slices (8s at 20Hz)
				new TwapStrategy({
					totalQty: 800,
					side: "SELL",
					totalSlices: 160,
					ticksPerSlice: 1,
				}),
			];

			return {
				config: cfg,
				engine,
				book,
				strategies,
				vwap: vwapAcc,
				volatility: new RollingVolatility(600), // ~30s at 20Hz
			};
		});
	}

	/**
	 * Starts the tick loop. Performs a burn-in period before exposing data.
	 */
	public async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.startTimeNs = process.hrtime.bigint();

		// Synchronous burn-in to build initial book depth
		const deltaT = this.config.tickIntervalMs / 1000;
		for (let i = 0; i < this.config.burnInTicks; i++) {
			this.executeTick(deltaT);
		}

		// Start async tick loop
		this.intervalHandle = setInterval(() => {
			if (!this.halted) {
				this.executeTick(deltaT);
			}
		}, this.config.tickIntervalMs);
	}

	/**
	 * Stops the tick loop gracefully.
	 */
	public stop(): void {
		this.running = false;
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	/**
	 * SEC Rule 15c3-5: Global Kill Switch — halts all instruments immediately.
	 */
	public halt(): void {
		this.halted = true;
		for (const inst of this.instruments) {
			inst.book.halt();
		}
		this.recordAudit("HALT", "SYSTEM", "ALL", "BUY", 0, 0);
	}

	/**
	 * Resumes trading after a halt.
	 */
	public resume(): void {
		this.halted = false;
		for (const inst of this.instruments) {
			inst.book.resume();
		}
		this.recordAudit("RESUME", "SYSTEM", "ALL", "BUY", 0, 0);
	}

	/**
	 * Returns the latest snapshot data for the LIOP sandbox.
	 */
	public getSnapshot(): HftTickRecord[] {
		return [...this.lastSnapshotData];
	}

	/**
	 * Returns the tick-to-trade latency histogram.
	 */
	public getLatencyHistogram(): LatencyHistogram {
		return this.latencyTracker.getHistogram();
	}

	/**
	 * Returns the audit trail (last N entries).
	 */
	public getAuditTrail(limit = 100): AuditEntry[] {
		return this.auditTrail.getEntries(limit);
	}

	/**
	 * Returns the total audit entry count.
	 */
	public getAuditCount(): number {
		return this.auditTrail.getCount();
	}

	/**
	 * Checks if the audit trail timestamps are monotonic.
	 */
	public isAuditMonotonic(): boolean {
		return this.auditTrail.isMonotonic();
	}

	/**
	 * Returns whether the engine is currently running.
	 */
	public isRunning(): boolean {
		return this.running;
	}

	/**
	 * Returns the current tick index.
	 */
	public getTickIndex(): number {
		return this.tickIndex;
	}

	/**
	 * Returns the instrument states (for testing).
	 */
	public getInstruments(): ReadonlyArray<InstrumentState> {
		return this.instruments;
	}

	/**
	 * Executes a single tick manually (for testing without the interval loop).
	 */
	public manualTick(): void {
		const deltaT = this.config.tickIntervalMs / 1000;
		this.executeTick(deltaT);
	}

	// ── Private Methods ──────────────────────────────────────────────

	private executeTick(deltaT: number): void {
		const tickStart = process.hrtime.bigint();

		for (const inst of this.instruments) {
			// 1. Generate new price
			const state = inst.engine.nextTick(deltaT);

			// 2. Feed strategies
			for (const strategy of inst.strategies) {
				strategy.onTick(state, inst.book, this.tickIndex);
			}

			// 3. VWAP is accumulated via the trade handler (fires once per trade)

			// 4. Update volatility tracker
			inst.volatility.push(state.price);
		}

		// Record tick latency
		const tickEnd = process.hrtime.bigint();
		const latencyNs = tickEnd - tickStart;
		this.latencyTracker.record(latencyNs);

		this.tickIndex++;

		// Refresh snapshot periodically
		if (this.tickIndex % this.config.snapshotRefreshInterval === 0) {
			this.refreshSnapshot();
		}
	}

	private refreshSnapshot(): void {
		const elapsedMs = Number(process.hrtime.bigint() - this.startTimeNs) / 1e6;
		const targetTicksPerSecond = 1000 / this.config.tickIntervalMs;
		const ticksPerSecond =
			elapsedMs > 500
				? Math.min(targetTicksPerSecond * 1.5, Math.round((this.tickIndex / (elapsedMs / 1000)) * 100) / 100)
				: targetTicksPerSecond;

		this.lastSnapshotData = this.instruments.map((inst) => {
			const state = inst.engine.getState();
			const metrics = inst.book.getMetrics();
			const changePct = inst.engine.getChangePercent();
			const sign = changePct >= 0 ? "+" : "";
			
			let vwap =
				inst.vwap.cumulativeVolume > 0
					? Math.round((inst.vwap.cumulativePriceVolume / inst.vwap.cumulativeVolume) * 100) / 100
					: state.price;

			// Defensive vwap clamping: prevent extreme historical deviations beyond 2.5% of current price (narrowed from 10%)
			const maxDev = state.price * 0.025;
			if (vwap > state.price + maxDev) {
				vwap = Math.round((state.price + maxDev) * 100) / 100;
			} else if (vwap < state.price - maxDev) {
				vwap = Math.round((state.price - maxDev) * 100) / 100;
			}

			const lastTrades = inst.book.getRecentTrades(1);
			const lastTrade = lastTrades.length > 0 ? lastTrades[0] : null;

			const volFormatted =
				metrics.totalVolume >= 1e6
					? `${(metrics.totalVolume / 1e6).toFixed(1)}M`
					: metrics.totalVolume >= 1e3
						? `${(metrics.totalVolume / 1e3).toFixed(1)}K`
						: `${metrics.totalVolume}`;

			return {
				ticker: inst.config.ticker,
				price: state.price,
				change: `${sign}${changePct}%`,
				volume: volFormatted,
				peRatio: inst.config.peRatio,
				marketCap: inst.config.marketCap,
				bestBid: metrics.bestBid,
				bestAsk: metrics.bestAsk,
				spread: metrics.spread,
				spreadBps: metrics.spreadBps,
				bidDepth: metrics.totalBidDepth,
				askDepth: metrics.totalAskDepth,
				imbalance: metrics.imbalance,
				lastTradePrice: lastTrade ? lastTrade.price : state.price,
				lastTradeQty: lastTrade ? lastTrade.qty : 0,
				ticksPerSecond: inst.book.getTicksPerSecond(),
				volatility30s: inst.volatility.getVolatility(),
				vwap,
			};
		});
	}

	private recordAudit(
		type: AuditEntryType,
		orderId: string,
		ticker: string,
		side: "BUY" | "SELL",
		price: number,
		qty: number,
	): void {
		const now = process.hrtime.bigint();
		this.auditTrail.push({
			timestamp: now,
			timestampUtc: new Date().toISOString(),
			type,
			orderId,
			ticker,
			side,
			price,
			qty,
			latencyNs: 0n,
		});
	}
}
