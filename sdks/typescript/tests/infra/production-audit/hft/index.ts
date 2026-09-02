/**
 * LIOP HFT Oracle — Public Module Exports
 */
export { HestonJumpDiffusionEngine } from "./pricing-engine.js";
export type { PricingState } from "./pricing-engine.js";

export { OrderBook } from "./order-book.js";

export {
	MarketMakerStrategy,
	NoiseTraderStrategy,
	TwapStrategy,
	VwapStrategy,
} from "./strategies.js";
export type { TradingStrategy } from "./strategies.js";

export { TickEngine } from "./tick-engine.js";
export type { InstrumentState } from "./tick-engine.js";

export { generateHftSnapshot, generateStaticHftDataset } from "./hft-dataset-generator.js";

export { DEFAULT_INSTRUMENTS } from "./types.js";
export type {
	AuditEntry,
	AuditEntryType,
	BookMetrics,
	HftTickRecord,
	InstrumentConfig,
	L2Snapshot,
	LatencyHistogram,
	Order,
	OrderSide,
	OrderStatus,
	OrderType,
	PriceLevel,
	TickEngineConfig,
	TradeEvent,
} from "./types.js";
