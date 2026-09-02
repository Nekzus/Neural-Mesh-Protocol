/**
 * LIOP HFT Oracle — Algorithmic Trading Strategies
 *
 * Synthetic trading bots that interact with the OrderBook to generate
 * realistic market activity. These strategies run inside the Oracle node
 * and are NOT accessible to external LIOP agents (internal simulation only).
 *
 * Strategies:
 * 1. Market Maker (simplified Avellaneda-Stoikov)
 * 2. VWAP (Volume-Weighted Average Price)
 * 3. TWAP (Time-Weighted Average Price)
 * 4. Noise Trader (random liquidity generator)
 */
import crypto from "node:crypto";
import { OrderBook } from "./order-book.js";
import type { OrderSide } from "./types.js";
import type { PricingState } from "./pricing-engine.js";

// ── Shared Utility ──────────────────────────────────────────────────

/** CSPRNG uniform [0, 1) */
function csprngUniform(): number {
	return (crypto.randomBytes(4).readUInt32BE(0) >>> 0) / 0xffffffff;
}

/** Round to 2 decimal places */
function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

// ── Strategy Interface ──────────────────────────────────────────────

export interface TradingStrategy {
	readonly name: string;
	/** Called every tick with the latest pricing state */
	onTick(state: PricingState, book: OrderBook, tickIndex: number): void;
}

// ── 1. Market Maker (Avellaneda-Stoikov Simplified) ─────────────────

export interface MarketMakerConfig {
	/** Base half-spread in percentage of mid-price (default: 0.05%) */
	baseSpreadPct: number;
	/** Order size per side (default: 100 shares) */
	orderSize: number;
	/** Maximum net inventory before skewing quotes (default: 500) */
	maxInventory: number;
	/** Inventory skew coefficient — larger = more aggressive skew */
	skewCoefficient: number;
	/** Number of price levels to quote on each side (default: 3) */
	quoteLevels: number;
}

const DEFAULT_MM_CONFIG: MarketMakerConfig = {
	baseSpreadPct: 0.0008,
	orderSize: 100,
	maxInventory: 500,
	skewCoefficient: 0.0001,
	quoteLevels: 3,
};

export class MarketMakerStrategy implements TradingStrategy {
	public readonly name = "MarketMaker";
	private readonly config: MarketMakerConfig;
	private inventory = 0;
	private activeOrderIds: string[] = [];

	constructor(config: Partial<MarketMakerConfig> = {}) {
		this.config = { ...DEFAULT_MM_CONFIG, ...config };
	}

	public onTick(state: PricingState, book: OrderBook): void {
		if (book.isHalted()) return;

		// Calculate filled quantity of previous quotes to update inventory before cancelling
		for (const id of this.activeOrderIds) {
			const order = book.getOrder(id);
			if (order && order.filledQty > 0) {
				if (order.side === "BUY") {
					this.inventory += order.filledQty;
				} else {
					this.inventory -= order.filledQty;
				}
			}
			book.cancelOrder(id);
		}
		this.activeOrderIds = [];

		const midPrice = state.price;
		const { baseSpreadPct, orderSize, skewCoefficient, quoteLevels } = this.config;

		// Inventory skew — bias quotes to reduce net position
		const inventorySkew = this.inventory * skewCoefficient;

		// Dynamic spread based on underlying CIR stochastic variance
		// scales spread when instantaneous volatility rises (protective MM horology)
		const vol = Math.sqrt(state.variance) || 0.001;
		const volMultiplier = 1.0 + vol * 300.0; // scales base spread up to 2.5x under volatility spikes
		const dynamicSpreadPct = baseSpreadPct * volMultiplier;

		// Inventory size skewing: reduce bid size and increase ask size when holding long inventory (and vice versa)
		const bidSize = Math.max(10, Math.round(orderSize * (1.0 - this.inventory / this.config.maxInventory)));
		const askSize = Math.max(10, Math.round(orderSize * (1.0 + this.inventory / this.config.maxInventory)));

		for (let level = 0; level < quoteLevels; level++) {
			const levelOffset = (level + 1) * dynamicSpreadPct * midPrice;

			// Bid price: mid - halfSpread - inventorySkew - levelOffset
			let bidPrice = round2(midPrice - dynamicSpreadPct * midPrice - inventorySkew - levelOffset);
			// Ask price: mid + halfSpread - inventorySkew + levelOffset
			let askPrice = round2(midPrice + dynamicSpreadPct * midPrice - inventorySkew + levelOffset);

			// Enforce minimum 2 ticks ($0.02) spread between the MM's own quotes to prevent crossing
			if (askPrice <= bidPrice + 0.01) {
				const mid = round2((bidPrice + askPrice) / 2);
				bidPrice = round2(mid - 0.01);
				askPrice = round2(mid + 0.01);
			}

			if (bidPrice >= 0.01 && Math.abs(this.inventory) < this.config.maxInventory) {
				const bidOrder = book.addLimitOrder("BUY", bidPrice, bidSize, this.name);
				this.activeOrderIds.push(bidOrder.id);
			}

			if (askPrice > bidPrice) {
				const askOrder = book.addLimitOrder("SELL", askPrice, askSize, this.name);
				this.activeOrderIds.push(askOrder.id);
			}
		}
	}
}

// ── 2. VWAP Strategy ────────────────────────────────────────────────

export interface VwapConfig {
	/** Total order quantity to execute */
	totalQty: number;
	/** Side of the parent order */
	side: OrderSide;
	/** Total number of time slices */
	totalSlices: number;
	/** Ticks between each slice execution */
	ticksPerSlice: number;
}

/**
 * Volume-Weighted Average Price execution strategy.
 * Uses a U-shaped volume profile (high at open/close, low mid-session).
 */
export class VwapStrategy implements TradingStrategy {
	public readonly name = "VWAP";
	private readonly config: VwapConfig;
	private executedQty = 0;
	private sliceIndex = 0;
	private volumeProfile: number[];

	constructor(config: VwapConfig) {
		this.config = config;
		// Generate U-shaped volume profile
		this.volumeProfile = this.generateUProfile(config.totalSlices);
	}

	public onTick(state: PricingState, book: OrderBook, tickIndex: number): void {
		if (book.isHalted()) return;
		if (this.executedQty >= this.config.totalQty) return;
		if (this.sliceIndex >= this.config.totalSlices) return;

		// Only act on slice boundaries
		if (tickIndex % this.config.ticksPerSlice !== 0) return;

		const remaining = this.config.totalQty - this.executedQty;
		const sliceWeight = this.volumeProfile[this.sliceIndex];
		const sliceQty = Math.min(
			Math.max(Math.round(this.config.totalQty * sliceWeight), 1),
			remaining,
		);

		if (sliceQty > 0) {
			const order = book.addLimitOrder(
				this.config.side,
				state.price,
				sliceQty,
				this.name,
			);
			this.executedQty += order.filledQty;
		}

		this.sliceIndex++;
	}

	/**
	 * U-shaped volume profile: higher weight at start and end.
	 */
	private generateUProfile(slices: number): number[] {
		const raw: number[] = [];
		for (let i = 0; i < slices; i++) {
			const normalized = (2 * i) / (slices - 1) - 1; // [-1, 1]
			raw.push(1 + normalized * normalized); // U-shape: min at center
		}
		const total = raw.reduce((s, v) => s + v, 0);
		return raw.map((v) => v / total);
	}
}

// ── 3. TWAP Strategy ────────────────────────────────────────────────

export interface TwapConfig {
	/** Total order quantity to execute */
	totalQty: number;
	/** Side of the parent order */
	side: OrderSide;
	/** Total number of time slices */
	totalSlices: number;
	/** Ticks between each slice execution */
	ticksPerSlice: number;
}

/**
 * Time-Weighted Average Price execution strategy.
 * Uniform distribution of child orders over the execution window.
 */
export class TwapStrategy implements TradingStrategy {
	public readonly name = "TWAP";
	private readonly config: TwapConfig;
	private executedQty = 0;
	private sliceIndex = 0;

	constructor(config: TwapConfig) {
		this.config = config;
	}

	public onTick(state: PricingState, book: OrderBook, tickIndex: number): void {
		if (book.isHalted()) return;
		if (this.executedQty >= this.config.totalQty) return;
		if (this.sliceIndex >= this.config.totalSlices) return;

		if (tickIndex % this.config.ticksPerSlice !== 0) return;

		const remaining = this.config.totalQty - this.executedQty;
		const sliceQty = Math.min(
			Math.ceil(this.config.totalQty / this.config.totalSlices),
			remaining,
		);

		if (sliceQty > 0) {
			const order = book.addLimitOrder(
				this.config.side,
				state.price,
				sliceQty,
				this.name,
			);
			this.executedQty += order.filledQty;
		}

		this.sliceIndex++;
	}
}

// ── 4. Noise Trader ─────────────────────────────────────────────────

export interface NoiseTraderConfig {
	/** Probability of placing an order on any given tick (default: 0.3) */
	orderProbability: number;
	/** Min order size (default: 10) */
	minOrderSize: number;
	/** Max order size (default: 200) */
	maxOrderSize: number;
	/** Max price offset from current price in % (default: 0.2%) */
	maxPriceOffsetPct: number;
	/** Probability of a market order vs limit (default: 0.2) */
	marketOrderProbability: number;
}

const DEFAULT_NOISE_CONFIG: NoiseTraderConfig = {
	orderProbability: 0.3,
	minOrderSize: 10,
	maxOrderSize: 200,
	maxPriceOffsetPct: 0.002,
	marketOrderProbability: 0.2,
};

/**
 * Random liquidity generator simulating retail/algorithmic participants.
 * Provides baseline trading activity and order book depth.
 */
export class NoiseTraderStrategy implements TradingStrategy {
	public readonly name = "NoiseTrader";
	private readonly config: NoiseTraderConfig;

	constructor(config: Partial<NoiseTraderConfig> = {}) {
		this.config = { ...DEFAULT_NOISE_CONFIG, ...config };
	}

	public onTick(state: PricingState, book: OrderBook): void {
		if (book.isHalted()) return;

		// Probabilistic order submission
		if (csprngUniform() > this.config.orderProbability) return;

		const side: OrderSide = csprngUniform() > 0.5 ? "BUY" : "SELL";
		const qty =
			this.config.minOrderSize +
			Math.floor(csprngUniform() * (this.config.maxOrderSize - this.config.minOrderSize));

		const isMarketOrder = csprngUniform() < this.config.marketOrderProbability;

		if (isMarketOrder) {
			book.addMarketOrder(side, qty, this.name);
		} else {
			// Limit order with random offset from current price, scaled dynamically by instantaneous volatility
			const vol = Math.sqrt(state.variance) || 0.001;
			const dynamicOffsetPct = this.config.maxPriceOffsetPct * (0.5 + vol * 200.0);
			const offsetPct = (csprngUniform() - 0.5) * 2 * dynamicOffsetPct;
			const price = round2(state.price * (1 + offsetPct));
			if (price > 0) {
				book.addLimitOrder(side, price, qty, this.name);
			}
		}
	}
}
