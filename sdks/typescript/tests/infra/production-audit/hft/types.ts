/**
 * LIOP HFT Oracle — Shared Type Definitions
 *
 * Domain types for the High-Frequency Trading simulation engine.
 * All monetary values use IEEE-754 double precision (sufficient for
 * 2-decimal price simulation; not suitable for real settlement).
 */

// ── Instrument Configuration ────────────────────────────────────────

/**
 * Calibrated parameters for a single tradeable instrument.
 * Uses the Heston stochastic volatility model with Merton jump diffusion.
 */
export interface InstrumentConfig {
	readonly ticker: string;
	readonly companyName: string;
	/** Initial spot price (S₀) */
	readonly initialPrice: number;
	/** Annualized drift (μ) — typically near zero for short simulations */
	readonly drift: number;
	/** Long-term variance (θ) — mean-reversion target for CIR process */
	readonly longVariance: number;
	/** Mean-reversion speed (κ) — higher = faster return to θ */
	readonly meanReversionSpeed: number;
	/** Volatility of volatility (σ_v) — "vol of vol" */
	readonly volOfVol: number;
	/** Correlation between price and variance Wiener processes (ρ) — leverage effect */
	readonly rho: number;
	/** Poisson jump intensity (λ) — expected jumps per second */
	readonly jumpIntensity: number;
	/** Jump size mean (log-normal, μ_J) */
	readonly jumpMean: number;
	/** Jump size std deviation (log-normal, σ_J) */
	readonly jumpStdDev: number;
	/** Static P/E ratio for display (null if not applicable) */
	readonly peRatio: number | null;
	/** Market capitalization string for display */
	readonly marketCap: string;
}

// ── Order Book Types ────────────────────────────────────────────────

export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "NEW" | "PARTIAL" | "FILLED" | "CANCELLED";

export interface Order {
	readonly id: string;
	readonly ticker: string;
	readonly side: OrderSide;
	readonly type: OrderType;
	price: number;
	qty: number;
	filledQty: number;
	status: OrderStatus;
	readonly timestampNs: bigint;
	readonly source: string;
}

export interface PriceLevel {
	readonly price: number;
	totalQty: number;
	orderCount: number;
	orders: Order[];
}

export interface L2Snapshot {
	readonly ticker: string;
	readonly bids: ReadonlyArray<{ price: number; qty: number; count: number }>;
	readonly asks: ReadonlyArray<{ price: number; qty: number; count: number }>;
	readonly bestBid: number;
	readonly bestAsk: number;
	readonly spread: number;
	readonly spreadBps: number;
	readonly midPrice: number;
	readonly imbalance: number;
}

export interface TradeEvent {
	readonly tradeId: string;
	readonly ticker: string;
	readonly price: number;
	readonly qty: number;
	readonly aggressorSide: OrderSide;
	readonly buyOrderId: string;
	readonly sellOrderId: string;
	readonly timestampNs: bigint;
}

export interface BookMetrics {
	readonly bestBid: number;
	readonly bestAsk: number;
	readonly spread: number;
	readonly spreadBps: number;
	readonly midPrice: number;
	readonly imbalance: number;
	readonly totalBidDepth: number;
	readonly totalAskDepth: number;
	readonly totalVolume: number;
	readonly tradeCount: number;
}

// ── Audit Trail Types ───────────────────────────────────────────────

export type AuditEntryType = "NEW" | "CANCEL" | "TRADE" | "MODIFY" | "HALT" | "RESUME";

export interface AuditEntry {
	readonly timestamp: bigint;
	readonly timestampUtc: string;
	readonly type: AuditEntryType;
	readonly orderId: string;
	readonly ticker: string;
	readonly side: OrderSide;
	readonly price: number;
	readonly qty: number;
	readonly latencyNs: bigint;
}

// ── Tick Engine Types ───────────────────────────────────────────────

export interface TickEngineConfig {
	/** Tick interval in milliseconds (default: 50 = 20Hz) */
	readonly tickIntervalMs: number;
	/** Number of instruments to simulate (default: 8) */
	readonly instrumentCount: number;
	/** Ring buffer size for audit trail (default: 50000) */
	readonly auditBufferSize: number;
	/** Burn-in ticks before exposing data (default: 40 = 2s at 20Hz) */
	readonly burnInTicks: number;
	/** How often to refresh the LIOP dataset snapshot (every N ticks) */
	readonly snapshotRefreshInterval: number;
}

export interface LatencyHistogram {
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
	readonly min: number;
	readonly max: number;
	readonly count: number;
	readonly unit: "ns";
}

// ── HFT Dataset Record (exposed to LIOP Sandbox) ───────────────────

export interface HftTickRecord {
	readonly ticker: string;
	readonly price: number;
	readonly change: string;
	readonly volume: string;
	readonly peRatio: number | null;
	readonly marketCap: string;
	readonly bestBid: number;
	readonly bestAsk: number;
	readonly spread: number;
	readonly spreadBps: number;
	readonly bidDepth: number;
	readonly askDepth: number;
	readonly imbalance: number;
	readonly lastTradePrice: number;
	readonly lastTradeQty: number;
	readonly ticksPerSecond: number;
	readonly volatility30s: number;
	readonly vwap: number;
}

// ── Default Instruments (8-asset HFT universe) ─────────────────────

export const DEFAULT_INSTRUMENTS: readonly InstrumentConfig[] = [
	{
		ticker: "AAPL",
		companyName: "Apple Inc.",
		initialPrice: 198.5,
		drift: 0.0001,
		longVariance: 0.04,
		meanReversionSpeed: 3.0,
		volOfVol: 0.3,
		rho: -0.7,
		jumpIntensity: 0.05,
		jumpMean: 0.0,
		jumpStdDev: 0.02,
		peRatio: 33.2,
		marketCap: "$3.0T",
	},
	{
		ticker: "MSFT",
		companyName: "Microsoft Corp.",
		initialPrice: 442.1,
		drift: 0.0001,
		longVariance: 0.03,
		meanReversionSpeed: 2.5,
		volOfVol: 0.25,
		rho: -0.65,
		jumpIntensity: 0.04,
		jumpMean: 0.0,
		jumpStdDev: 0.015,
		peRatio: 36.8,
		marketCap: "$3.3T",
	},
	{
		ticker: "GOOGL",
		companyName: "Alphabet Inc.",
		initialPrice: 178.2,
		drift: 0.0001,
		longVariance: 0.05,
		meanReversionSpeed: 3.5,
		volOfVol: 0.35,
		rho: -0.75,
		jumpIntensity: 0.06,
		jumpMean: 0.0,
		jumpStdDev: 0.025,
		peRatio: 24.1,
		marketCap: "$2.2T",
	},
	{
		ticker: "AMZN",
		companyName: "Amazon.com Inc.",
		initialPrice: 205.8,
		drift: 0.0001,
		longVariance: 0.04,
		meanReversionSpeed: 3.0,
		volOfVol: 0.3,
		rho: -0.7,
		jumpIntensity: 0.05,
		jumpMean: 0.0,
		jumpStdDev: 0.02,
		peRatio: 62.4,
		marketCap: "$2.1T",
	},
	{
		ticker: "NVDA",
		companyName: "Nvidia Corp.",
		initialPrice: 135.6,
		drift: 0.0002,
		longVariance: 0.08,
		meanReversionSpeed: 4.0,
		volOfVol: 0.5,
		rho: -0.8,
		jumpIntensity: 0.1,
		jumpMean: 0.0,
		jumpStdDev: 0.04,
		peRatio: 68.5,
		marketCap: "$3.3T",
	},
	{
		ticker: "TSLA",
		companyName: "Tesla Inc.",
		initialPrice: 285.4,
		drift: 0.0002,
		longVariance: 0.1,
		meanReversionSpeed: 5.0,
		volOfVol: 0.6,
		rho: -0.85,
		jumpIntensity: 0.15,
		jumpMean: 0.0,
		jumpStdDev: 0.05,
		peRatio: 182.3,
		marketCap: "$910B",
	},
	{
		ticker: "META",
		companyName: "Meta Platforms Inc.",
		initialPrice: 625.3,
		drift: 0.0001,
		longVariance: 0.03,
		meanReversionSpeed: 2.5,
		volOfVol: 0.25,
		rho: -0.65,
		jumpIntensity: 0.04,
		jumpMean: 0.0,
		jumpStdDev: 0.015,
		peRatio: 27.9,
		marketCap: "$1.6T",
	},
	{
		ticker: "AMD",
		companyName: "Advanced Micro Devices Inc.",
		initialPrice: 165.9,
		drift: 0.0002,
		longVariance: 0.06,
		meanReversionSpeed: 3.5,
		volOfVol: 0.4,
		rho: -0.75,
		jumpIntensity: 0.08,
		jumpMean: 0.0,
		jumpStdDev: 0.03,
		peRatio: 115.8,
		marketCap: "$268B",
	},
] as const;
