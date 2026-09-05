// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { countTokens, setMergeCacheSize } from "gpt-tokenizer/model/gpt-4o";
import { log } from "../utils/logger.js";

/**
 * TokenEstimator — Pluggable strategy for counting tokens in text content.
 *
 * Implementations range from exact BPE tokenization to lightweight heuristics,
 * allowing the SDK to choose the best trade-off for the runtime environment.
 */
export interface TokenEstimator {
	/** Count the number of tokens in the given text */
	countTokens(text: string): number;
	/** Human-readable name of the estimation strategy */
	readonly name: string;
}

/**
 * Exact BPE tokenizer using inlined o200k_base encoding.
 *
 * o200k_base is the standard encoding for all modern OpenAI models
 * (GPT-4o, GPT-4.1, o1, o3, o4) and provides a reasonable baseline
 * for Anthropic/Google models as well (~±5% variance).
 *
 * - Synchronous: safe for hot-path usage without async overhead
 * - Merge cache reduced to 10K entries for long-running server processes
 * - Inlined at build-time: zero external runtime dependencies in node_modules
 */
export class RealTokenEstimator implements TokenEstimator {
	readonly name = "o200k_base";

	private countFn: (text: string) => number;

	constructor(
		countFn: (text: string) => number,
		setMergeCacheSizeFn?: (size: number) => void,
	) {
		this.countFn = countFn;
		// Reduce merge cache from default 100K to 10K for server processes
		if (setMergeCacheSizeFn) {
			try {
				setMergeCacheSizeFn(10_000);
			} catch {
				// Non-fatal if merge cache size adjustment is not supported
			}
		}
	}

	countTokens(text: string): number {
		if (text.length === 0) return 0;
		return this.countFn(text);
	}
}

/**
 * Fallback heuristic estimator: ~4 characters per token.
 *
 * Industry-standard approximation (±10% for English/code content).
 * Used only when tokenizer fails in constrained environments.
 */
export class HeuristicTokenEstimator implements TokenEstimator {
	readonly name = "heuristic (chars/4)";

	countTokens(text: string): number {
		if (text.length === 0) return 0;
		return Math.ceil(text.length / 4);
	}
}

/**
 * Factory: creates a RealTokenEstimator with inlined o200k_base,
 * falling back to HeuristicTokenEstimator if an unexpected error occurs.
 */
export async function createTokenEstimator(): Promise<TokenEstimator> {
	try {
		const estimator = new RealTokenEstimator(countTokens, setMergeCacheSize);
		log.debug("[LIOP-Economy] Token estimator initialized: o200k_base");
		return estimator;
	} catch {
		log.info(
			"[LIOP-Economy] Inlined tokenizer initialization error, falling back to heuristic estimator",
		);
		return new HeuristicTokenEstimator();
	}
}

/**
 * Synchronous factory: creates a RealTokenEstimator immediately.
 */
export function createSyncTokenEstimator(): TokenEstimator {
	try {
		return new RealTokenEstimator(countTokens, setMergeCacheSize);
	} catch {
		return new HeuristicTokenEstimator();
	}
}
