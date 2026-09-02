/**
 * LIOP HFT Oracle — Heston + Jump Diffusion Pricing Engine
 *
 * Generates realistic tick-level price paths using the Heston stochastic
 * volatility model combined with Merton jump diffusion. Discretized via
 * the truncated Euler-Maruyama scheme to prevent negative variance.
 *
 * All randomness sourced from crypto.randomBytes() (CSPRNG, NIST SP 800-226).
 */
import crypto from "node:crypto";
import type { InstrumentConfig } from "./types.js";

/**
 * Generates a standard normal variate using the Box-Muller transform.
 * Uses crypto.randomBytes() for CSPRNG — never Math.random().
 */
function csprngNormal(): number {
	const bytes = crypto.randomBytes(8);
	const u1 = (bytes.readUInt32BE(0) >>> 0) / 0xffffffff;
	const u2 = (bytes.readUInt32BE(4) >>> 0) / 0xffffffff;
	// Clamp to avoid log(0)
	const safeU1 = Math.max(u1, 1e-10);
	return Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generates a uniform [0, 1) variate from CSPRNG.
 */
function csprngUniform(): number {
	const bytes = crypto.randomBytes(4);
	return (bytes.readUInt32BE(0) >>> 0) / 0xffffffff;
}

export interface PricingState {
	price: number;
	variance: number;
	openPrice: number;
	highPrice: number;
	lowPrice: number;
	tickCount: number;
	hadJump: boolean;
}

/**
 * Heston + Jump Diffusion pricing engine for a single instrument.
 *
 * The Heston SDE system:
 *   dS = μ·S·dt + √v·S·dW₁ + J·S·dN
 *   dv = κ·(θ - v)·dt + σ_v·√v·dW₂
 *
 * Correlated Wiener processes via Cholesky:
 *   dW₂ = ρ·dW₁ + √(1-ρ²)·dZ   (Z independent of W₁)
 */
export class HestonJumpDiffusionEngine {
	private state: PricingState;
	private readonly config: InstrumentConfig;
	private static readonly TIME_SCALE_FACTOR = 1 / 25000; // Calibrated for highly realistic 2-5 bps tick movements

	constructor(config: InstrumentConfig) {
		this.config = config;
		const initialVar = config.longVariance * HestonJumpDiffusionEngine.TIME_SCALE_FACTOR;
		this.state = {
			price: config.initialPrice,
			variance: initialVar,
			openPrice: config.initialPrice,
			highPrice: config.initialPrice,
			lowPrice: config.initialPrice,
			tickCount: 0,
			hadJump: false,
		};
	}

	/**
	 * Advances the price process by deltaT seconds.
	 * Returns the updated state snapshot.
	 */
	public nextTick(deltaT: number): PricingState {
		const { drift, longVariance, meanReversionSpeed, volOfVol, rho, jumpIntensity, jumpMean, jumpStdDev } =
			this.config;

		let { price, variance } = this.state;

		const scale = HestonJumpDiffusionEngine.TIME_SCALE_FACTOR;
		const scaledLongVariance = longVariance * scale;
		const scaledVolOfVol = volOfVol * Math.sqrt(scale);
		const scaledDrift = drift * scale;

		// Hardening: Prevent NaN propagating or initial state corrupted
		if (Number.isNaN(price) || price <= 0) {
			price = this.config.initialPrice;
		}
		if (Number.isNaN(variance) || variance <= 0) {
			variance = scaledLongVariance;
		}

		// 1. Generate correlated normal variates via Cholesky decomposition
		const z1 = csprngNormal();
		const zIndep = csprngNormal();
		const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * zIndep;

		// 2. Update variance (CIR process) with a minimum positive floor to prevent lock-up or NaN
		const varianceFloor = 1e-8;
		const sqrtVar = Math.sqrt(Math.max(variance, varianceFloor));
		const dVariance =
			meanReversionSpeed * (scaledLongVariance - variance) * deltaT + scaledVolOfVol * sqrtVar * Math.sqrt(deltaT) * z2;
		variance = Math.max(variance + dVariance, varianceFloor);
		if (Number.isNaN(variance)) {
			variance = scaledLongVariance;
		}

		// 3. Update price (GBM with stochastic vol)
		const dPrice = scaledDrift * price * deltaT + sqrtVar * price * Math.sqrt(deltaT) * z1;
		price = price + dPrice;
		if (Number.isNaN(price)) {
			price = this.config.initialPrice;
		}

		// 4. Jump diffusion (Poisson arrival + log-normal size)
		let hadJump = false;
		const jumpProb = jumpIntensity * deltaT;
		if (csprngUniform() < jumpProb) {
			const jumpSize = Math.exp(jumpMean + jumpStdDev * csprngNormal()) - 1;
			price = price * (1 + jumpSize);
			if (Number.isNaN(price)) {
				price = this.config.initialPrice;
			}
			hadJump = true;
		}

		// 5. Floor at minimum tick (price cannot go below $0.01)
		price = Math.max(price, 0.01);

		// 6. Round to 2 decimal places (standard equity tick size)
		price = Math.round(price * 100) / 100;

		this.state = {
			price,
			variance,
			openPrice: this.state.openPrice,
			highPrice: Math.max(this.state.highPrice, price),
			lowPrice: Math.min(this.state.lowPrice, price),
			tickCount: this.state.tickCount + 1,
			hadJump,
		};

		return { ...this.state };
	}

	/**
	 * Returns the current state without advancing.
	 */
	public getState(): Readonly<PricingState> {
		return { ...this.state };
	}

	/**
	 * Returns the percentage change from the open price.
	 */
	public getChangePercent(): number {
		const pctChange = ((this.state.price - this.state.openPrice) / this.state.openPrice) * 100;
		return Math.round(pctChange * 100) / 100;
	}

	/**
	 * Resets the session (new trading day).
	 */
	public resetSession(): void {
		this.state = {
			...this.state,
			openPrice: this.state.price,
			highPrice: this.state.price,
			lowPrice: this.state.price,
			tickCount: 0,
		};
	}
}
