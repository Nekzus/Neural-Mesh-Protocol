import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { createMlKem768 } from "mlkem";
import { FixedQueue, Piscina } from "piscina";
import { z } from "zod";
import {
	type LiopManifest,
	MeshNode,
	type MeshNodeConfig,
} from "../mesh/node.js";
import {
	egressBlocksTotal,
	fuelConsumed,
	toolCallsTotal,
} from "../observability/metrics.js";
import { Dilithium65Wrapper } from "../rpc/crypto/dilithium.js";
import { LiopRpcServer } from "../rpc/server.js";
import type { LogicRequest, LogicResponse } from "../rpc/types.js";
import {
	type AuditLogger,
	globalAuditLogger,
} from "../security/audit-logger.js";
import { AUTH_DEFAULTS } from "../security/auth-config.js";
import { JwtValidator } from "../security/jwt-validator.js";
import { createOAuthServer } from "../security/oauth-server.js";
import { authorizeRequest } from "../security/rbac.js";
import { TaintAnalyzer } from "../security/taint-analyzer.js";
import type {
	CallToolRequest,
	CallToolResult,
	GetPromptRequest,
	GetPromptResult,
	Prompt,
	Resource,
	ServerInfo,
	Tool,
} from "../types.js";
import { log } from "../utils/logger.js";
import { NerScanner } from "./ner-scanner.js";
import {
	type OutputSanitizerConfig,
	sanitizeOutput,
} from "./output-sanitizer.js";
import { PII_PATTERNS, PII_PRESETS, type PiiRule, PiiScanner } from "./pii.js";

export {
	NerScanner,
	type OutputSanitizerConfig,
	PII_PATTERNS,
	PII_PRESETS,
	type PiiRule,
	PiiScanner,
	sanitizeOutput,
};

export type ToolHandler<T extends z.ZodRawShape = z.ZodRawShape> = (
	args: z.infer<z.ZodObject<T>>,
	extra: { signal?: AbortSignal },
) => Promise<CallToolResult>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LiopServerOptions {
	capabilities?: Record<string, unknown>;
	workerPool?: {
		enabled?: boolean;
		minThreads?: number;
		maxThreads?: number;
		idleTimeout?: number;
		/** Max heap memory per worker in MB (default: 64). Prevents heap bomb DoS. */
		maxHeapMb?: number;
		/** Maximum number of tasks allowed in the queue. Default is "auto". */
		maxQueue?: number | "auto";
	};
	security?: {
		piiPatterns?: PiiRule[];
		forbiddenKeys?: string[];
		sensitiveKeys?: string[];
		/** Enable NLP-based Named Entity Recognition scanning on output values. */
		enableNerScanning?: boolean;
		/** Rate limiting configuration for tool calls (OWASP A01). */
		rateLimit?: {
			/** Maximum calls per window per tool (default: 15). */
			maxPerWindow?: number;
			/** Maximum calls per window across ALL tools combined (default: 40). */
			globalMaxPerWindow?: number;
			/** Sliding window duration in milliseconds (default: 60000 = 1 min). */
			windowMs?: number;
		};
	};
	taxonomy?: {
		domain?: string;
		clearanceTier?: number;
		executionTypes?: string[];
	};
	/**
	 * OAuth 2.1 Hybrid Auth configuration.
	 *
	 * Minimal usage:
	 *   - Nexus (Authorization Server): `{ role: "nexus" }`
	 *   - Data Node (Resource Server): `{ role: "node" }`
	 *   - Disabled (dev/stdio): omit or `{ role: "none" }`
	 *
	 * All other values (issuer, JWKS, audience) auto-resolve from
	 * env vars, DHT discovery, or secure defaults.
	 */
	auth?: import("../security/auth-config.js").LiopAuthConfig;
	/**
	 * Canonical slug for deterministic token resolution.
	 * Agents/clients resolve `LIOP_TOKEN_<tokenSlug>` from environment.
	 * Must match SCREAMING_SNAKE_CASE: /^[A-Z][A-Z0-9_]*$/ (e.g., "BANK", "VAULT", "HFT_ORACLE").
	 */
	tokenSlug?: string;
	/**
	 * SOC 2 Type II / HIPAA immutable audit logger instance.
	 */
	auditLogger?: AuditLogger;
	/**
	 * Path to a shared JSON file for persistent Query Budget tracking across multiple server instances.
	 */
	budgetStorePath?: string;
}

export interface AggregationPolicy {
	/** Maximum number of object-type array elements allowed (default: 10) */
	maxOutputRows?: number;
	/** Allow arrays containing only primitive values (default: true) */
	allowPrimitiveArrays?: boolean;
	/** Block min/max extraction when dataset size < this value (default: 50) */
	minMaxBlockThreshold?: number;
}

export interface LogicExecutionPolicy {
	/**
	 * Validate the business payload returned by sandbox logic (post-execution).
	 * This runs before final egress checks and blocks non-conforming outputs.
	 */
	outputSchema?: z.ZodType<unknown>;
	/**
	 * Enforce aggregation-first heuristics (preflight + post-check).
	 */
	enforceAggregationFirst?: boolean | AggregationPolicy;
	/**
	 * Optional additional deny patterns checked against extracted logic source.
	 */
	preflightDenyPatterns?: RegExp[];
	/**
	 * Differential Privacy epsilon per query (default: 1.0).
	 * Lower = stronger privacy + more noise. Standard: Apple iOS uses 1.0.
	 */
	dpEpsilon?: number;
	/**
	 * DP sensitivity: max change when one record added/removed (default: 1.0).
	 * For SUM queries on a field with range [0, X], set sensitivity = X.
	 */
	dpSensitivity?: number;
	/**
	 * Dataset size threshold below which Differential Privacy is active (default: 50).
	 */
	dpSmallDatasetThreshold?: number;
	/**
	 * Max queries per numeric field per PQC session (default: 5).
	 * Prevents multi-query differencing attacks.
	 */
	queryBudgetPerField?: number;
	/**
	 * Domain-specific sensitive keys that fall under the "sensitive" query budget tier.
	 */
	sensitiveKeys?: string[];
	/**
	 * Path to a shared JSON file for persistent Query Budget tracking across multiple server instances.
	 */
	budgetStorePath?: string;
}

export class LiopServer {
	private logicCache: Map<string, { hash: string; timestamp: number }> =
		new Map();
	private connectionStats: Map<
		string,
		{ failures: number; lastAttempt: number }
	> = new Map();
	private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
	private readonly THROTTLE_THRESHOLD = 5;
	private readonly THROTTLE_COOLDOWN_MS = 60 * 1000; // 60 seconds

	// [OWASP-A01] Sliding window rate limiter — prevents micro-query exfiltration
	private toolCallWindows: Map<string, number[]> = new Map();
	private readonly toolCallMaxPerWindow: number;
	private readonly toolCallWindowMs: number;

	// [OWASP-A01] Global cross-tool rate limiter — prevents distributed micro-query attacks
	private globalCallWindow: number[] = [];
	private readonly globalCallMaxPerWindow: number;

	// [DP] Query Budget — tracks per-field query counts to prevent multi-query differencing
	// Structure: clientId -> toolName -> field -> count
	private fieldQueryBudget: Map<string, Map<string, Map<string, number>>> =
		new Map();

	// [SEC] AST-level taint tracker for PII side-channel prevention
	private readonly taintAnalyzer: TaintAnalyzer;

	private tools: Map<
		string,
		{
			tool: Tool;
			// biome-ignore lint/suspicious/noExplicitAny: Erased at runtime
			handler: ToolHandler<any>;
			// biome-ignore lint/suspicious/noExplicitAny: Erased at runtime
			schema: z.ZodObject<any>;
			policy?: LogicExecutionPolicy;
		}
	> = new Map();
	private resources: Map<
		string,
		Resource & { content?: string | (() => Promise<string>) }
	> = new Map();
	private prompts: Map<
		string,
		{
			prompt: Prompt;
			handler: (
				request: GetPromptRequest,
			) => GetPromptResult | Promise<GetPromptResult>;
		}
	> = new Map();
	private activeSchema: Record<string, unknown> | null = null;
	private sandboxRecords: Record<string, unknown>[] = [];

	private piiScanner: PiiScanner;
	private workerPool: Piscina;
	private meshNode: MeshNode | null = null;
	private rpcServer: LiopRpcServer | null = null;
	private boundPort: number | null = null;
	public jwtValidator?: JwtValidator;
	// biome-ignore lint/suspicious/noExplicitAny: Loaded dynamically in Phase C
	public oauthProvider?: any;
	private sessions: Map<
		string,
		{
			capability_hash: string;
			kyber_sk: Uint8Array;
			agent_did?: string;
			tokenHash?: string;
			createdAt: number;
		}
	> = new Map();
	private revokedTokenHashes: Set<string> = new Set();
	private lastRevocationLoadTime = 0;
	private pqcKeyPair = Dilithium65Wrapper.generateKeyPair();
	public readonly auditLogger: AuditLogger;

	public getDatasetHash(): string {
		return crypto
			.createHash("sha256")
			.update(JSON.stringify(this.sandboxRecords || []))
			.digest("hex");
	}

	// Compact envelope: @LIOP{target,name}\n<code>\n@END
	private static readonly LIOP_COMPACT_REGEX =
		/@LIOP\{(?<target>[^,}]+)(?:,\s*(?<name>[^}]*))?\}[\r\n]+(?<logic>[\s\S]*?)[\r\n]+@END/m;

	private extractLogic(payload: string): string | null {
		if (!payload || typeof payload !== "string") return null;
		const compact = payload.trim().match(LiopServer.LIOP_COMPACT_REGEX);
		return compact?.groups?.logic ? compact.groups.logic.trim() : null;
	}

	private parseUnknownJson(input: unknown): unknown {
		if (typeof input !== "string") return input;
		const trimmed = input.trim();
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			try {
				return JSON.parse(trimmed);
			} catch {
				return input;
			}
		}
		return input;
	}

	private runPreflightPolicy(
		_toolName: string,
		logic: string,
		policy?: LogicExecutionPolicy,
		clientId = "local-client",
	): string | null {
		// Phase 1: Regex-based row-level export detection (fast path)
		if (policy) {
			const compact = logic.replace(/\s+/g, " ");

			if (policy.enforceAggregationFirst) {
				const rowExtractionPatterns = [
					// Block raw record dumps but allow safe aggregation chains
					// (.reduce, .length, .filter().length, .every, .some)
					/return\s+env\.records(?!\s*\.\s*(?:reduce|length|filter|every|some|find)\b)/i,
					/return\s*\{[\s\S]*\b(accounts|patients|rows|records)\s*:\s*env\.records(?!\s*\.\s*(?:reduce|length|filter)\b)/i,
				];
				if (rowExtractionPatterns.some((p) => p.test(compact))) {
					return "Preflight policy rejected: potential row-level export pattern detected.";
				}
			}

			if (policy.preflightDenyPatterns?.some((p) => p.test(compact))) {
				return "Preflight policy rejected: custom deny pattern matched.";
			}
		}

		// Phase 2: AST-level taint tracking (detects PII side-channel derivation)
		// Pass recordCount and minMaxBlockThreshold to enable Correlation Guard (Pass 4) and Min/Max Gate (Pass 5)
		let minMaxThreshold = 50;
		if (typeof policy?.enforceAggregationFirst === "object") {
			minMaxThreshold =
				policy.enforceAggregationFirst.minMaxBlockThreshold ?? 50;
		}
		const taintViolation = this.taintAnalyzer.analyze(
			logic,
			this.sandboxRecords.length,
			minMaxThreshold,
		);
		if (taintViolation) {
			return `Preflight policy rejected: ${taintViolation.reason}`;
		}

		// Phase 3: Query Budget Enforcement (prevents multi-query differencing)
		const extractedFields = this.taintAnalyzer.extractQueriedFields(logic);

		if (extractedFields.length > 0) {
			// Guard against prototype pollution attacks (CWE-915 / js/prototype-polluting-assignment)
			if (
				clientId === "__proto__" ||
				clientId === "constructor" ||
				clientId === "prototype" ||
				_toolName === "__proto__" ||
				_toolName === "constructor" ||
				_toolName === "prototype"
			) {
				return "Preflight policy rejected: invalid property key names (prototype pollution guard).";
			}

			const storePath = policy?.budgetStorePath || this.config?.budgetStorePath;
			if (storePath) {
				try {
					const budgetError = this.executeWithBudgetLock(
						storePath,
						(budget) => {
							const clientBudget = budget[clientId] || {};
							const toolBudget = clientBudget[_toolName] || {};

							for (const field of extractedFields) {
								const sensitivity = this.taintAnalyzer.classifyField(
									field,
									policy?.sensitiveKeys,
								);

								let queryLimit = 25; // default public
								let sensLabel = "public";

								if (policy?.queryBudgetPerField !== undefined) {
									queryLimit = policy.queryBudgetPerField;
									sensLabel = "override";
								} else if (sensitivity === "forbidden") {
									queryLimit = 3;
									sensLabel = "forbidden";
								} else if (sensitivity === "sensitive") {
									queryLimit = 8;
									sensLabel = "sensitive";
								}

								const count = toolBudget[field] ?? 0;
								if (count >= queryLimit) {
									return {
										result: `Preflight policy rejected: Query budget exceeded for field '${field}' (max ${queryLimit} per session for ${sensLabel} fields). Rotate PQC session to reset budget.`,
									};
								}
							}

							// All within budget, increment them
							const updatedToolBudget = { ...toolBudget };
							for (const field of extractedFields) {
								updatedToolBudget[field] = (updatedToolBudget[field] ?? 0) + 1;
							}

							const updatedClientBudget = { ...clientBudget };
							updatedClientBudget[_toolName] = updatedToolBudget;

							const updatedBudget = { ...budget };
							updatedBudget[clientId] = updatedClientBudget;

							return { result: null, updatedBudget };
						},
					);

					if (budgetError) {
						return budgetError;
					}
				} catch (e: unknown) {
					const errorMsg = e instanceof Error ? e.message : String(e);
					// Fallback to in-memory on filesystem locking errors
					log.error(
						`[LIOP-Server] Error applying persistent query budget: ${errorMsg}. Falling back to in-memory.`,
					);
					const inMemoryError = this.applyInMemoryBudget(
						clientId,
						_toolName,
						extractedFields,
						policy,
					);
					if (inMemoryError) return inMemoryError;
				}
			} else {
				const inMemoryError = this.applyInMemoryBudget(
					clientId,
					_toolName,
					extractedFields,
					policy,
				);
				if (inMemoryError) return inMemoryError;
			}
		}

		return null;
	}

	private validateOutputPolicy(
		toolName: string,
		output: unknown,
		policy?: LogicExecutionPolicy,
	): string | null {
		if (!policy) return null;
		const parsed = this.parseUnknownJson(output);

		// If it's a system execution error result, skip schema validation
		if (
			parsed &&
			typeof parsed === "object" &&
			(parsed as Record<string, unknown>).isError === true
		) {
			return null;
		}

		if (policy.outputSchema) {
			// SEC-HARDENING: Force strict mode on ZodObject schemas to prevent
			// key aliasing bypasses via .passthrough(). However, respect schemas
			// that explicitly use .catchall() — calling .strict() would override
			// the catchall with ZodNever, destroying the developer's intent.
			const effectiveSchema = (() => {
				if (!(policy.outputSchema instanceof z.ZodObject)) {
					return policy.outputSchema;
				}
				const obj = policy.outputSchema as z.ZodObject<z.ZodRawShape>;
				// biome-ignore lint/suspicious/noExplicitAny: library version compatibility check
				const def = (obj as any).def || (obj as any)._def;
				// If schema has an explicit catchall (not ZodNever), respect it.
				// In Zod v4, default catchall is undefined, so we check for both.
				if (
					def &&
					def.catchall !== undefined &&
					!(def.catchall instanceof z.ZodNever)
				) {
					return obj;
				}
				// Otherwise force strict to block unrecognized keys by default
				return obj.strict();
			})();

			const schemaResult = effectiveSchema.safeParse(parsed);
			if (!schemaResult.success) {
				// SEC-CRITICAL: Never expose rejected data in error messages.
				// Only report the structural violation (unrecognized keys, type mismatches).
				return `[LIOP] Output schema violation for ${toolName}: ${schemaResult.error.issues
					.map((i) => `${i.path.join(".") || "<root>"} ${i.message}`)
					.join(
						"; ",
					)}. HINT: Your output must conform to the declared schema. Use 'env.records' to access the dataset and return only allowed fields.`;
			}
		}

		if (
			policy.enforceAggregationFirst &&
			this.violatesAggregationFirstPolicy(
				this.unwrapForAggregationPolicyScan(parsed),
				policy.enforceAggregationFirst,
				this.sandboxRecords.length,
			)
		) {
			const isDev =
				process.env.NODE_ENV === "development" ||
				process.env.NODE_ENV === "test" ||
				process.env.LIOP_SEC_VERBOSE === "1";

			return isDev
				? "Aggregation-First Policy Violation: row-level export or K-Anonymity violation blocked. HINT: Use .reduce() to produce a flat {key:value} object. Do NOT use .map() to create arrays of objects. Ensure dataset size > 10 for detailed results."
				: "Aggregation-First Policy Violation: Output blocked due to privacy constraints.";
		}

		return null;
	}

	/**
	 * Proxied tools stringify a full MCP CallToolResult (`{ content: [...] }`).
	 * Aggregation-first heuristics must scan the inner business JSON, not the MCP envelope
	 * (otherwise `content` looks like a tabular array of objects and everything blocks).
	 */
	private unwrapForAggregationPolicyScan(input: unknown): unknown {
		if (typeof input === "string") {
			const trimmed = input.trim();
			if (
				(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
				(trimmed.startsWith("[") && trimmed.endsWith("]"))
			) {
				try {
					return this.unwrapForAggregationPolicyScan(JSON.parse(trimmed));
				} catch {
					return input;
				}
			}
			return input;
		}

		if (!input || typeof input !== "object") {
			return input;
		}

		const rec = input as Record<string, unknown>;

		// Extract inner business computation result if encapsulated inside a LIOP envelope
		if (rec.computation_result !== undefined) {
			return this.unwrapForAggregationPolicyScan(rec.computation_result);
		}

		if (!Array.isArray(rec.content) || rec.content.length === 0) {
			return input;
		}

		const texts: string[] = [];
		for (const part of rec.content) {
			if (part && typeof part === "object" && "text" in part) {
				const t = (part as { text?: unknown }).text;
				if (typeof t === "string") {
					texts.push(t);
				}
			}
		}
		if (texts.length === 0) {
			return input;
		}

		const joined = texts.length === 1 ? texts[0] : texts.join("\n");
		return this.unwrapForAggregationPolicyScan(joined);
	}

	private violatesAggregationFirstPolicy(
		input: unknown,
		policyObj?: boolean | AggregationPolicy,
		recordsCount?: number,
	): boolean {
		if (!policyObj) {
			return false;
		}

		const maxRows =
			typeof policyObj === "object" &&
			typeof policyObj.maxOutputRows === "number"
				? policyObj.maxOutputRows
				: 10;
		const allowPrimitives =
			typeof policyObj === "object" &&
			typeof policyObj.allowPrimitiveArrays === "boolean"
				? policyObj.allowPrimitiveArrays
				: true;

		if (typeof input === "string") {
			const trimmed = input.trim();
			if (
				(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
				(trimmed.startsWith("[") && trimmed.endsWith("]"))
			) {
				try {
					return this.violatesAggregationFirstPolicy(
						JSON.parse(trimmed),
						policyObj,
						recordsCount,
					);
				} catch {
					return false;
				}
			}
			return false;
		}

		if (Array.isArray(input)) {
			if (
				input.length > 0 &&
				input.every((item) => typeof item === "object" && item !== null)
			) {
				// Treat tabular row export as non-aggregated leakage risk if above threshold.
				if (input.length > maxRows) {
					return true;
				}
				return input.some((item) =>
					this.violatesAggregationFirstPolicy(item, policyObj, recordsCount),
				);
			}

			if (
				input.length > 0 &&
				input.every((item) => typeof item !== "object" || item === null)
			) {
				if (!allowPrimitives) return true;
				return false;
			}

			return input.some((item) =>
				this.violatesAggregationFirstPolicy(item, policyObj, recordsCount),
			);
		}

		if (input && typeof input === "object") {
			const keys = Object.keys(input as Record<string, unknown>);

			// K-ANONYMITY: If source dataset is too small (< 10), enforce restriction.
			// Allow basic statistical summaries (max 3 keys: count/avg/stddev, no nesting).
			if (recordsCount !== undefined && recordsCount > 0 && recordsCount < 10) {
				if (keys.length > 3) return true;
				// Check for nesting/arrays in a small sample
				const values = Object.values(input as Record<string, unknown>);
				if (
					values.some(
						(v) => Array.isArray(v) || (typeof v === "object" && v !== null),
					)
				) {
					return true;
				}
			}

			// Treat flat dictionary with too many keys as non-aggregated leakage risk (Dynamic Key Bypass).
			if (keys.length > maxRows) {
				return true;
			}

			return Object.values(input as Record<string, unknown>).some((value) =>
				this.violatesAggregationFirstPolicy(value, policyObj, recordsCount),
			);
		}

		return false;
	}

	constructor(
		private serverInfo: ServerInfo,
		private config?: LiopServerOptions,
	) {
		const nerScanner = this.config?.security?.enableNerScanning
			? new NerScanner()
			: null;

		this.piiScanner = new PiiScanner(
			this.config?.security?.piiPatterns ?? PII_PRESETS.GLOBAL_STRICT,
			this.config?.security?.forbiddenKeys ?? [
				"id",
				"name",
				"fullName",
				"firstName",
				"lastName",
				"address",
				"street",
				"city",
				"postalCode",
				"zipCode",
				"phone",
				"email",
				"ssn",
				"accountHolder",
				"accountNumber",
				"account_number",
				"password",
				"token",
				"secret",
				"privateKey",
			],
			nerScanner,
		);

		// [OWASP-A01] Rate limit: config > env > default (15 calls/min per-tool, 40 global)
		const rlConfig = this.config?.security?.rateLimit;
		this.toolCallWindowMs =
			rlConfig?.windowMs ??
			Number.parseInt(process.env.LIOP_RATE_LIMIT_WINDOW_MS ?? "60000", 10);
		this.toolCallMaxPerWindow =
			rlConfig?.maxPerWindow ??
			Number.parseInt(process.env.LIOP_RATE_LIMIT_MAX ?? "15", 10);
		this.globalCallMaxPerWindow =
			rlConfig?.globalMaxPerWindow ??
			Number.parseInt(process.env.LIOP_RATE_LIMIT_GLOBAL_MAX ?? "40", 10);

		// [SEC] Initialize AST-level taint analyzer with PII field definitions
		const forbiddenKeys = this.config?.security?.forbiddenKeys ?? [
			"id",
			"name",
			"fullName",
			"firstName",
			"lastName",
			"address",
			"street",
			"city",
			"postalCode",
			"zipCode",
			"phone",
			"email",
			"ssn",
			"accountHolder",
			"accountNumber",
			"account_number",
			"password",
			"token",
			"secret",
			"privateKey",
		];
		const sensitiveKeys = this.config?.security?.sensitiveKeys ?? [];
		this.taintAnalyzer = new TaintAnalyzer(forbiddenKeys, sensitiveKeys);
		this.auditLogger = this.config?.auditLogger || globalAuditLogger;

		// Initialize Zero-Blocking Worker Pool for Heavy Cryptography & Sandboxing
		const isTS = import.meta.url.endsWith(".ts");
		const workerExt = isTS ? ".ts" : ".js";

		let execArgv: string[] = [];
		if (isTS) {
			try {
				const req = createRequire(import.meta.url);
				const tsxPkg = req.resolve("tsx/package.json");
				const absoluteTsx = pathToFileURL(
					path.join(path.dirname(tsxPkg), "dist", "loader.mjs"),
				).href;
				execArgv = ["--import", absoluteTsx];
			} catch (_e) {
				execArgv = ["--import", "tsx"];
			}
		}

		const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;

		// Sync capabilities to serverInfo for MCP Handshakes
		if (this.config?.capabilities && !this.serverInfo.capabilities) {
			this.serverInfo.capabilities = this.config.capabilities as Record<
				string,
				unknown
			>;
		}

		// Support both flat dist/ and original src/ structure
		const workerPaths = [
			path.resolve(__dirname, `./workers/logic-execution${workerExt}`), // Flat dist/ (tsup)
			path.resolve(__dirname, `../workers/logic-execution${workerExt}`), // Original src/
		];

		const workerFilename =
			workerPaths.find((p) => fs.existsSync(p)) || workerPaths[1];

		this.workerPool = new Piscina({
			filename: workerFilename,
			minThreads: this.config?.workerPool?.minThreads ?? (isTest ? 0 : 2),
			maxThreads: this.config?.workerPool?.maxThreads ?? (isTest ? 1 : 8),
			idleTimeout:
				this.config?.workerPool?.idleTimeout ?? (isTest ? 500 : 5000),
			maxQueue: this.config?.workerPool?.maxQueue ?? "auto",
			taskQueue: new FixedQueue(),
			execArgv,
			// [DoS Defense] Enforce hard memory ceiling per worker thread.
			// Workers exceeding this limit are terminated by Node.js runtime.
			resourceLimits: {
				maxOldGenerationSizeMb:
					this.config?.workerPool?.maxHeapMb ??
					Number.parseInt(process.env.LIOP_WORKER_MAX_HEAP_MB ?? "64", 10),
			},
		});

		// Pre-warm the worker thread pool asynchronously during initialization
		const minThreads = this.config?.workerPool?.minThreads ?? (isTest ? 0 : 2);
		if (this.workerPool && minThreads > 0) {
			for (let i = 0; i < minThreads; i++) {
				this.workerPool.run({ isWarmup: true }).catch((err) => {
					log.debug(
						`[LiopServer] Worker pool warm-up ping failed: ${err.message}`,
					);
				});
			}
		}

		// [SEC] Initialize JWT Validator and OAuth Server if auth is enabled
		if (this.config?.auth?.role === "nexus") {
			const issuer = this.config.auth.issuer || "http://localhost:3000";
			const audience = this.config.auth.audience || AUTH_DEFAULTS.audience;

			// Auto-detect or default clients for the Nexus
			const clients = this.config.auth.clients || [
				{
					client_id: process.env.LIOP_OAUTH_CLIENT_ID || "liop-mesh-agent",
					client_secret:
						process.env.LIOP_OAUTH_CLIENT_SECRET || "dev-secret-change-me",
					grant_types: ["client_credentials"],
					scope:
						"liop:tools:call liop:tools:list liop:resources:read liop:schema:read liop:mesh:query",
				},
			];

			const { provider, jwks } = createOAuthServer({
				issuer,
				clients,
			});

			this.oauthProvider = provider;
			this.jwtValidator = new JwtValidator(issuer, audience, jwks);
		} else if (this.config?.auth?.role === "node") {
			const nexusUrl =
				this.config.auth.nexusUrl ||
				process.env.LIOP_NEXUS_URL ||
				"http://localhost:3000";
			const audience = this.config.auth.audience || AUTH_DEFAULTS.audience;
			const baseUrl = nexusUrl.endsWith("/oidc")
				? nexusUrl
				: `${nexusUrl}/oidc`;
			const jwksUri = new URL(`${baseUrl}/jwks`);
			this.jwtValidator = new JwtValidator(nexusUrl, audience, jwksUri);
		}

		// [Token Economy] Auto-register LIOP protocol spec as a single Resource.
		// This centralizes the envelope documentation that was previously
		// duplicated in every tool description, reducing token overhead.
		this.resource(
			"LIOP Envelope Specification",
			"liop://protocol/envelope-spec",
			"Complete Logic-on-Origin envelope format, execution rules, and security constraints",
			"text/plain",
			() => Promise.resolve(this.buildEnvelopeSpec()),
		);

		if (this.config?.auth?.revocationPath) {
			this.loadRevocationList();
		}
	}
	/**
	 * Builds the centralized LIOP envelope specification document.
	 * Served as a single Resource (liop://protocol/envelope-spec) instead
	 * of being duplicated across every tool description.
	 */
	private buildEnvelopeSpec(): string {
		const lines = [
			"LIOP v1 Envelope Specification",
			"================================",
			"",
			"FORMAT:",
			"",
			"Compact Envelope:",
			"  @LIOP{wasi_v1,TaskName}",
			"  <JavaScript code>",
			"  @END",
			"",
			"RUNTIME ENVIRONMENT:",
			"- env.records: Array of data objects from the origin",
			"- Must use 'return' to output results",
			"- Zero-Trust WASI Sandbox (Node.js Worker Pool)",
			"- Return aggregated objects, NOT raw row-level arrays",
			"",
			"SANDBOX RUNTIME RESTRICTIONS & WORKAROUNDS:",
			"- Date is poisoned: The 'Date' class/constructor is undefined (Date.now(), Date.parse(), etc. will throw).",
			"  Workaround: Use lexicographical string comparison on ISO 8601 date strings (e.g., record.date >= '2024-01-01').",
			"- Poisoned globals: eval, Function, setTimeout, setInterval, Buffer, ArrayBuffer, and TypedArrays are undefined.",
			"- Frozen prototypes: Any modifications to Object.prototype, Array.prototype, etc., are blocked.",
			"",
			"SECURITY CONSTRAINTS:",
			"- PII Egress Shield blocks raw identifiers in output",
			"- Aggregation-First policy: prefer counts, averages, summaries",
			"- AST Guardian: static analysis before execution",
			"",
			"DIFFERENTIAL PRIVACY (DP) MECHANISM (Laplace Mechanism):",
			"- Default field noise scale is derived from node global sensitivity.",
			"- COUNT / LENGTH Optimization: To obtain EXACT counts without noise (sensitivity=1),",
			"  the return keys MUST contain 'count', 'length', 'size', 'num', 'positive', 'negative',",
			"  or start with 'total_' or 'num_' (e.g. 'total_tx', 'credits_count').",
			"- AVERAGE Optimization: Keys containing 'avg', 'mean' or 'average' scale noise",
			"  down automatically by dividing sensitivity by dataset size (sensitivity / n).",
			"- SUM / OTHER queries: Receive full Laplace noise based on global node sensitivity",
			"  (e.g., Sensitivity=100,000 in Bank to protect balances).",
		];

		if (this.config?.security?.forbiddenKeys?.length) {
			lines.push(
				`- Restricted fields: ${this.config.security.forbiddenKeys.join(", ")}`,
			);
		}

		lines.push(
			"",
			"TAINT TRACKING (Phase 108):",
			"- AST-level analysis blocks PII-derived scalars (charCodeAt, charAt, etc.)",
			"- Operations on restricted fields are tracked through variable assignments",
			"- Boolean inference (field.charCodeAt(0) < N ? 1 : 0) is blocked",
			"- Allowed: aggregations on non-PII fields (balance, amount, date)",
			"",
			"K-ANONYMITY THRESHOLDS:",
			"- Small Datasets (< 10 records): Maximum of 3 scalar output fields. Nesting or arrays in output are strictly forbidden.",
			"- Large Datasets (>= 10 records): Maximum of 10 output fields.",
			"",
			"RATE LIMITS (OWASP A01):",
			"- Per-tool: 15 calls/min (configurable via LIOP_RATE_LIMIT_MAX)",
			"- Global: 40 calls/min across all tools (LIOP_RATE_LIMIT_GLOBAL_MAX)",
			"",
			"OPTIONAL PARAMETERS:",
			"- __liop_bypass_ast_cache: boolean (force AST re-evaluation)",
			"",
			"QUERY BUDGET TIERS (NIST SP 800-226):",
			"- FORBIDDEN (PII fields like name, accountHolder): Blocked in AST preflight. Never executed, does not consume budget.",
			"- SENSITIVE (fields marked via sensitiveKeys): 8 queries per agent identity (or queryBudgetPerField override).",
			"- PUBLIC (all other fields): 25 queries per agent identity.",
			"- PERSISTENCE: The budget is tracked by agent DID and persisted to disk, NOT by MCP session.",
			"  Reconnecting or starting a new session does NOT reset the budget.",
			"  Reset requires: administrator calling resetFieldBudget() or manual deletion of the budget store file.",
			"",
			"AUTHENTICATION (tokenSlug Convention):",
			"- Restricted nodes declare authRequired: true in their manifest.",
			"- Token resolution: LIOP_TOKEN_<tokenSlug> (deterministic) > LIOP_TOKEN_<PeerID> > LIOP_TOKEN_<ProviderName>",
			"- Format: tokenSlug must match SCREAMING_SNAKE_CASE /^[A-Z][A-Z0-9_]*$/ (e.g., BANK, VAULT, HFT_ORACLE).",
		);

		return lines.join("\n");
	}

	/**
	 * Extracts a compact, human-readable field summary from a JSON Schema.
	 *
	 * Walks the schema structure to find actual data property names and types,
	 * rather than returning top-level schema metadata keys (type, items, etc.).
	 *
	 * Example output for a banking schema:
	 *   "Array of {id(string), accountHolder(string), balance(number), transactions(array of {date(string), amount(number)})}"
	 */
	private extractSchemaFieldSummary(
		schema: Record<string, unknown>,
		depth = 0,
	): string {
		// Prevent excessive recursion in deeply nested schemas
		if (depth > 3) return "{...}";

		const schemaType = schema.type as string | undefined;
		const properties = schema.properties as
			| Record<string, Record<string, unknown>>
			| undefined;
		const items = schema.items as Record<string, unknown> | undefined;

		// Object with properties → list field names with their types
		if (properties) {
			const fields = Object.entries(properties).map(([key, prop]) => {
				const propType = prop.type as string | undefined;
				if (propType === "array" && prop.items) {
					const nested = this.extractSchemaFieldSummary(
						prop.items as Record<string, unknown>,
						depth + 1,
					);
					return `${key}(array of ${nested})`;
				}
				if (propType === "object" && prop.properties) {
					const nested = this.extractSchemaFieldSummary(prop, depth + 1);
					return `${key}(${nested})`;
				}
				return `${key}(${propType || "unknown"})`;
			});
			return `{${fields.join(", ")}}`;
		}

		// Array type → describe the items structure
		if (schemaType === "array" && items) {
			const itemsSummary = this.extractSchemaFieldSummary(items, depth + 1);
			return `Array of ${itemsSummary}`;
		}

		// Simple type or unknown structure → fallback to key listing
		if (schemaType) return schemaType;
		return Object.keys(schema).join(", ");
	}

	/**
	 * Convenience alias for connectToMesh(), matching official documentation.
	 */
	public async connect(
		options: { port?: number; meshConfig?: MeshNodeConfig } = {},
	): Promise<void> {
		return this.connectToMesh(options);
	}

	/**
	 * Register a new Tool
	 */
	public tool<T extends z.ZodRawShape>(
		name: string,
		description: string,
		shape: T,
		handler: ToolHandler<T>,
		policy?: LogicExecutionPolicy,
	): void {
		if (this.tools.has(name)) {
			throw new Error(`Tool already registered: ${name}`);
		}

		const schema = z.object(shape);
		const generatedSchema = z.toJSONSchema(schema, { target: "draft-07" });

		let finalDescription = description;
		let finalHandler = handler;

		// LIOP Zero-Shot Autonomy Middleware: Detect Logic-on-Origin tools
		if (shape.payload && shape.payload instanceof z.ZodString) {
			const blockedKeys = this.config?.security?.forbiddenKeys || [];

			// [Token Economy] Centralized description: reference the protocol spec
			// Resource instead of duplicating the full envelope format per tool.
			// Same information, delivered once via liop://protocol/envelope-spec.
			finalDescription +=
				"\n\nPayload: LIOP v1 envelope (WASI sandbox)." +
				" Format: @LIOP{wasi_v1,TaskName}\\n<JS code>\\n@END" +
				" | Access data: env.records. Return aggregated object." +
				" Note: If dataset size < 10 (synthetic demo), Egress K-Anonymity blocks output if it has >3 keys or any array/nested object." +
				" | Full spec: resource liop://protocol/envelope-spec";

			if (blockedKeys.length > 0) {
				finalDescription += `\nRestricted fields: ${blockedKeys.join(", ")}.`;
			}

			if (this.activeSchema) {
				const schemaDigest = this.extractSchemaFieldSummary(this.activeSchema);
				finalDescription += `\nData structure: ${schemaDigest}. Full schema: resource liop://schema/global`;
			}

			finalHandler = async (
				args: z.infer<z.ZodObject<T>>,
				_extra: { signal?: AbortSignal },
			) => {
				const clientId = "global_connection"; // Simplify for now, treating the instance as one connection
				const now = Date.now();
				const stats = this.connectionStats.get(clientId) || {
					failures: 0,
					lastAttempt: 0,
				};

				if (
					stats.failures >= this.THROTTLE_THRESHOLD &&
					now - stats.lastAttempt < this.THROTTLE_COOLDOWN_MS
				) {
					return {
						content: [
							{
								type: "text",
								text: "LIOP_THROTTLED: Too many violations. Cooling down for 60 seconds.",
							},
						],
						isError: true,
					};
				}

				const payloadValue = (args as Record<string, unknown>)
					.payload as string;
				const bypassCache =
					(args as Record<string, unknown>).__liop_bypass_ast_cache === true;

				const payloadHash = crypto
					.createHash("sha256")
					.update(payloadValue)
					.digest("hex");
				const logic = this.extractLogic(payloadValue);
				const cached = this.logicCache.get(payloadHash);

				if (
					!bypassCache &&
					cached &&
					now - cached.timestamp < this.CACHE_TTL_MS
				) {
					// Hash verified. Skips boundaries check (already validated!). Extract logic directly.
					if (logic) {
						(args as Record<string, unknown>).payload = logic;

						// DELEGATE TO WORKER POOL: Parallel PQC & Sandboxing
						const preflightReason = this.runPreflightPolicy(
							name,
							logic,
							policy,
							"mcp-client",
						);
						if (preflightReason) {
							return {
								content: [{ type: "text", text: preflightReason }],
								isError: true,
							};
						}
						return await this.executeInWorkerPool(args, logic, name);
					}
				}

				if (!logic) {
					stats.failures++;
					stats.lastAttempt = now;
					this.connectionStats.set(clientId, stats);
					return {
						content: [
							{
								type: "text",
								text: "Error: Malformed payload. Missing @LIOP boundary.\\nYou MUST wrap your logic exactly like this:\\n\\n@LIOP{wasi_v1,DynamicAudit}\\n// Your JS code here\\n@END",
							},
						],
						isError: true,
					};
				}

				try {
					// Logic check already performed above, extraction is guaranteed at this point.
					// biome-ignore lint/style/noNonNullAssertion: safe extraction after check
					const logic = this.extractLogic(
						(args as Record<string, unknown>).payload as string,
					)!;
					// Extract pure logic and deliver it to the developer's function
					(args as Record<string, unknown>).payload = logic;

					// DELEGATE TO WORKER POOL: Parallel PQC & Sandboxing (Includes PII Shield)
					const preflightReason = this.runPreflightPolicy(
						name,
						logic,
						policy,
						"mcp-client",
					);
					if (preflightReason) {
						stats.failures++;
						stats.lastAttempt = now;
						this.connectionStats.set(clientId, stats);
						return {
							content: [{ type: "text", text: preflightReason }],
							isError: true,
						};
					}

					const result = await this.executeInWorkerPool(args, logic, name);

					if (!result.isError) {
						this.connectionStats.set(clientId, {
							failures: 0,
							lastAttempt: now,
						});
						this.logicCache.set(payloadHash, {
							hash: payloadHash,
							timestamp: now,
						});
					} else {
						stats.failures++;
						stats.lastAttempt = now;
						this.connectionStats.set(clientId, stats);
					}

					return result;
				} catch (error: unknown) {
					const e = error as Error;
					stats.failures++;
					stats.lastAttempt = now;
					this.connectionStats.set(clientId, stats);
					return {
						content: [
							{ type: "text", text: `ExecutionRuntimeException: ${e.message}` },
						],
						isError: true,
					};
				}
			};
		}

		const inputSchema = {
			type: "object",
			properties: (generatedSchema as Record<string, unknown>).properties || {},
			required: (generatedSchema as Record<string, unknown>).required,
		};

		this.tools.set(name, {
			tool: { name, description: finalDescription, inputSchema },
			handler: finalHandler,
			schema,
			policy,
		});

		// [LIOP-ALPHA] Auto-announce capability to the Mesh P2P DHT if node is active
		if (this.meshNode) {
			this.meshNode.announceCapability(name).catch((err) => {
				log.info(
					`[LIOP-Mesh] Failed to auto-announce tool ${name}: ${err.message}`,
				);
			});
		}
	}

	/**
	 * Register a dynamic prompt
	 */
	public prompt(
		name: string,
		description: string | undefined,
		args: Prompt["arguments"],
		handler: (
			request: GetPromptRequest,
		) => GetPromptResult | Promise<GetPromptResult>,
	): void {
		if (this.prompts.has(name)) {
			throw new Error(`Prompt already registered: ${name}`);
		}
		this.prompts.set(name, {
			prompt: { name, description, arguments: args },
			handler,
		});
	}

	/**
	 * Enables LIOP Zero-Shot Autonomy by registering the Blind Analyst standard prompt.
	 */
	public enableZeroShotAutonomy(): void {
		this.prompt(
			"liop_blind_analyst",
			"The official Logic-Injection-on-Origin Protocol system prompt. Instructs the LLM on how to securely inject Logic-on-Origin without violating PII or safety constraints.",
			[],
			(_request) => {
				return {
					description: "LIOP Blind Analyst Instructions",
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: `You are the "Blind Analyst" operating within the Logic-Injection-on-Origin Protocol (LIOP) ecosystem.
Your objective is to perform secure Logic-on-Origin injections. You must process remote data without ever requesting its extraction.

INDUSTRIAL CONSTRAINTS & PROTOCOL RULES:
1. DATA PRIVACY: NEVER attempt to export Personally Identifiable Information (PII). The LIOP Egress Shield will block any response containing raw IDs, names, or addresses.
2. AGGREGATION FIRST & K-ANONYMITY THRESHOLDS: Always prefer returning counts, averages, or anonymized summaries.
   - Dataset < 10 records: Maximum of 3 scalar output fields. Nesting or arrays in output are strictly forbidden.
   - Dataset >= 10 records: Maximum of 10 output fields.
3. LAPLACE DIFFERENTIAL PRIVACY (DP) COMPLIANCE:
   - Legitimate COUNT queries: To obtain EXACT, un-noised counts, you MUST name your return keys containing 'count', 'length', 'size', 'num', 'positive', 'negative', or starting with 'total_' or 'num_' (e.g. 'total_tx', 'credits_count'). This forces sensitivity=1.0, rounds values, and clamps to non-negative values.
   - Legitimate AVERAGE queries: Use 'avg_', '_average' or 'mean_' keys to automatically scale down Laplace noise by dividing sensitivity by the dataset size (sensitivity / n).
   - Legitimate SUM queries: Return keys without count/average suffixes will receive full Laplacian noise scaled by the node's global sensitivity (which can be up to 100,000 in Bank nodes to protect raw balances). Do NOT attempt to bypass this by renaming sum fields to count fields, as it violates protocol integrity.
4. PAYLOAD ENCAPSULATION: Your JavaScript payloads MUST strictly adhere to the Compact Envelope. DO NOT include markdown backticks or leading text inside the 'payload' argument.
   Structure:
   @LIOP{wasi_v1,AnalysisTask}
   // Your JS Code Here
   @END
5. RUNTIME SCOPE: The execution environment provides a global 'env' object. Use 'env.records' to access the target dataset.
6. LOCALIZATION: Format all JSON response keys in the language used by the user in their query (e.g., use Spanish keys if the query is in Spanish).
7. SCHEMA RIGIDITY: Only use fields defined in the 'Data Dictionary'. Usage of non-existent fields will trigger a sandbox runtime exception.
8. SANDBOX RUNTIME: The 'Date' class/constructor is poisoned and set to undefined. Calling 'new Date()', 'Date.now()', or 'Date.parse()' will throw exceptions.
   Workaround: Perform chronological operations and filtering using lexicographical string comparisons on ISO 8601 date strings (e.g., 'record.date >= "2024-01-01"').
   Additionally, standard globals like 'eval', 'Function', 'setTimeout', 'setInterval', 'Buffer', ArrayBuffer, and TypedArrays are also undefined.
9. QUERY BUDGET PERSISTENCE: The per-field query budget is tracked by your agent DID and persisted to disk. Reconnecting or starting a new MCP session does NOT reset the budget. If you receive "Query budget exceeded", you must use a different field or request an administrator to invoke resetFieldBudget().${
									this.activeSchema
										? `\n\nCURRENT DATA DICTIONARY (STRICT):\n${JSON.stringify(this.activeSchema, null, 2)}`
										: ""
								}

Protocol Adherence is mandatory for successful execution.`,
							},
						},
					],
				};
			},
		);
	}

	/**
	 * Register a dynamic resource
	 */
	public resource(
		name: string,
		uri: string,
		description?: string,
		mimeType?: string,
		content?: string | (() => Promise<string>),
	): void {
		if (this.resources.has(uri)) {
			throw new Error(`Resource URI already registered: ${uri}`);
		}
		this.resources.set(uri, { name, uri, description, mimeType, content });
	}

	/**
	 * Builds execution guidelines served as a resource to guide LLM code generation.
	 */
	private buildExecutionGuidelines(): string {
		return [
			"LIOP Sandbox Execution Guidelines",
			"=================================",
			"",
			"1. DATE POISONING & FILTERING WORKAROUND:",
			"   The global 'Date' class is set to undefined inside the sandbox. Calling 'new Date()', 'Date.now()', or 'Date.parse()' will throw a ReferenceError.",
			"   - Workaround: Perform chronological filtering using lexicographical string comparisons on ISO 8601 strings.",
			"     Example: const filtered = env.records.filter(r => r.date >= '2024-01-01' && r.date <= '2024-12-31');",
			"",
			"2. K-ANONYMITY CONSTRAINTS:",
			"   - Datasets with LESS than 10 records: The returned object must contain at most 3 scalar fields, and must NOT contain any arrays or nested objects.",
			"   - Datasets with 10 or MORE records: The returned object can contain up to 10 fields.",
			"",
			"3. DIFFERENTIAL PRIVACY SUFFIXES:",
			"   To avoid Laplacian noise adding random perturbations to your counts or averages, you must name your object keys using specific terms:",
			"   - Counts (Exact, no noise): Key names must contain 'count', 'length', 'size', 'num', 'positive', 'negative', or start with 'total_' or 'num_'.",
			"   - Averages (Reduced noise): Key names must contain 'avg', 'mean', or 'average'.",
			"   - Sums/Other: Will receive full Laplace noise.",
			"",
			"4. GENERAL RESTRICTIONS:",
			"   - Do not use 'eval', 'Function', 'setTimeout', 'setInterval', 'Buffer', 'ArrayBuffer', or TypedArrays.",
			"   - Do not attempt to modify prototypes (Object.prototype, Array.prototype).",
			"",
			"5. QUERY BUDGET TIERS (NIST SP 800-226):",
			"   The per-field query budget is tracked by agent DID and persisted to disk (not per MCP session).",
			"   - FORBIDDEN (PII fields): Always blocked in AST preflight. Does not consume budget.",
			"   - SENSITIVE (sensitiveKeys): 8 queries per agent identity (or queryBudgetPerField override).",
			"   - PUBLIC (other fields): 25 queries per agent identity.",
			"   - Reset requires administrator intervention via resetFieldBudget().",
		].join("\n");
	}

	/**
	 * Broadcasts the Data Dictionary to the LLM prior to code injection.
	 */
	public dataDictionary(
		schema: Record<string, unknown>,
		name: string = "Global Medical Data Dictionary",
		uri: string = "liop://schema/global",
		description: string = "Exposes the internal database schema for Zero-Shot Autonomy planning",
	): void {
		// Inject $comment directive to assist LLMs directly inside the JSON Schema representation
		schema.$comment =
			"LIOP DIRECTIVES: 1. Date is undefined (Date.now(), new Date() throw). Workaround: use lexicographical string comparison on ISO 8601 string dates (e.g. record.date >= '2024-01-01'). 2. Small datasets (<10 records) limit outputs to max 3 scalar keys with NO nesting. 3. DP counts must contain count/length/size/num/total_ prefix/suffix.";

		this.activeSchema = schema;

		// [Token Economy] Retroactively update tool descriptions with schema field references.
		// Extracts actual data property names from the JSON Schema structure.
		const schemaDigest = this.extractSchemaFieldSummary(schema);
		for (const [toolName, entry] of this.tools.entries()) {
			if (
				entry.schema.shape.payload &&
				entry.schema.shape.payload instanceof z.ZodString &&
				entry.tool.description &&
				!entry.tool.description.includes("Data structure:")
			) {
				entry.tool.description += `\nData structure: ${schemaDigest}. Full schema: resource ${uri}. Guidelines: resource liop://schema/guidelines`;
				this.tools.set(toolName, entry);
			}
		}

		if (!this.resources.has("liop://schema/guidelines")) {
			this.resource(
				"LIOP Execution Guidelines",
				"liop://schema/guidelines",
				"Directives for generating compliant JavaScript code for the LIOP Sandbox runtime",
				"text/plain",
				() => Promise.resolve(this.buildExecutionGuidelines()),
			);
		}

		this.resource(
			name,
			uri,
			description,
			"application/json",
			JSON.stringify(schema, null, 2),
		);
	}

	/**
	 * Manually invalidates the AST Logic Cache (e.g. for Zero-Day patches).
	 */
	public clearAstCache(): void {
		this.logicCache.clear();
		log.info("[LIOP-SDK] AST Security Cache cleared by Admin.");
	}

	/**
	 * Sliding window rate limiter for tool call frequency.
	 * Prevents micro-query exfiltration attacks where an attacker
	 * makes hundreds of individually-legitimate calls to reconstruct
	 * the full dataset field by field. (OWASP A01)
	 */
	private checkToolCallRateLimit(toolName: string): CallToolResult | null {
		const now = Date.now();
		const windowMs = this.toolCallWindowMs;
		const maxPerWindow = this.toolCallMaxPerWindow;

		const window = this.toolCallWindows.get(toolName) || [];
		// Evict expired timestamps outside the sliding window
		const active = window.filter((t) => now - t < windowMs);

		if (active.length >= maxPerWindow) {
			const retryAfterSec = Math.ceil((active[0] + windowMs - now) / 1000);
			return {
				content: [
					{
						type: "text",
						text:
							`LIOP_RATE_LIMITED: Too many calls to ${toolName}. ` +
							`Max ${maxPerWindow} per ${windowMs / 1000}s window. ` +
							`Retry after ${retryAfterSec}s.`,
					},
				],
				isError: true,
			};
		}

		active.push(now);
		this.toolCallWindows.set(toolName, active);
		return null;
	}

	/**
	 * Global cross-tool rate limiter.
	 * Prevents attackers from distributing micro-queries across multiple tools
	 * to evade per-tool rate limits. (OWASP A01)
	 */
	private checkGlobalRateLimit(): CallToolResult | null {
		const now = Date.now();
		const windowMs = this.toolCallWindowMs;
		const maxGlobal = this.globalCallMaxPerWindow;

		this.globalCallWindow = this.globalCallWindow.filter(
			(t) => now - t < windowMs,
		);

		if (this.globalCallWindow.length >= maxGlobal) {
			const retryAfterSec = Math.ceil(
				(this.globalCallWindow[0] + windowMs - now) / 1000,
			);
			return {
				content: [
					{
						type: "text",
						text:
							`LIOP_RATE_LIMITED: Global call limit exceeded. ` +
							`Max ${maxGlobal} total calls per ${windowMs / 1000}s window. ` +
							`Retry after ${retryAfterSec}s.`,
					},
				],
				isError: true,
			};
		}

		this.globalCallWindow.push(now);
		return null;
	}

	/**
	 * Emulates calling a tool (used locally or via LIOPMcpBridge)
	 */
	public async callTool(
		request: CallToolRequest,
		clientId = "local-client",
	): Promise<CallToolResult> {
		const entry = this.tools.get(request.name);
		if (!entry) {
			throw new Error(`Tool not found: ${request.name}`);
		}

		// [OWASP-A01] Rate limiting: prevent micro-query exfiltration
		const globalLimitResult = this.checkGlobalRateLimit();
		if (globalLimitResult) return globalLimitResult;
		const rateLimitResult = this.checkToolCallRateLimit(request.name);
		if (rateLimitResult) return rateLimitResult;

		try {
			// Validate inputs natively with Zod before execution
			const parsedArgs = entry.schema.parse(request.arguments || {});

			// Re-inject the bypass flag if present since Zod might strip unrecognized keys
			if (
				(request.arguments as Record<string, unknown>)
					?.__liop_bypass_ast_cache === true
			) {
				(parsedArgs as Record<string, unknown>).__liop_bypass_ast_cache = true;
			}

			// [LOGIC-ON-ORIGIN] Intercept code injection directly
			if (
				parsedArgs &&
				typeof (parsedArgs as Record<string, unknown>).payload === "string"
			) {
				const payload = (parsedArgs as Record<string, unknown>)
					.payload as string;
				const logic = this.extractLogic(payload);
				if (logic) {
					const preflightReason = this.runPreflightPolicy(
						request.name,
						logic,
						entry.policy,
						clientId,
					);
					if (preflightReason) {
						return {
							content: [{ type: "text", text: preflightReason }],
							isError: true,
						};
					}
					(parsedArgs as Record<string, unknown>).payload = logic;
					return await this.executeInWorkerPool(
						parsedArgs,
						logic,
						request.name,
					);
				}
			}

			const result = await entry.handler(parsedArgs, {});
			return result;
		} catch (error: unknown) {
			const e = error as Error;
			if (e instanceof z.ZodError) {
				return {
					content: [{ type: "text", text: `Validation Error: ${e.message}` }],
					isError: true,
				};
			}
			return {
				content: [
					{ type: "text", text: `Internal Execution Error: ${e.message}` },
				],
				isError: true,
			};
		}
	}

	/**
	 * Retrieves registered tools
	 */
	public listTools(): Tool[] {
		return Array.from(this.tools.values()).map((t) => t.tool);
	}

	/**
	 * Retrieves registered prompts
	 */
	public listPrompts(): Prompt[] {
		return Array.from(this.prompts.values()).map((p) => p.prompt);
	}

	/**
	 * Gets a specific prompt by name
	 */
	public async getPrompt(request: GetPromptRequest): Promise<GetPromptResult> {
		const entry = this.prompts.get(request.name);
		if (!entry) {
			throw new Error(`Prompt not found: ${request.name}`);
		}
		return await entry.handler(request);
	}

	/**
	 * Retrieves registered resources
	 */
	public listResources(): Resource[] {
		return Array.from(this.resources.values());
	}

	/**
	 * Reads a specific resource by URI
	 */
	public async readResource(uri: string): Promise<{
		contents: Array<{ uri: string; mimeType?: string; text: string }>;
	}> {
		const resource = this.resources.get(uri);
		if (!resource) {
			throw new Error(`Resource not found: ${uri}`);
		}

		let text = "No description provided";
		if (typeof resource.content === "function") {
			text = await resource.content();
		} else if (typeof resource.content === "string") {
			text = resource.content;
		} else if (resource.description) {
			text = resource.description;
		}

		return {
			contents: [
				{
					uri: resource.uri,
					mimeType: resource.mimeType || "text/plain",
					text,
				},
			],
		};
	}

	public getServerInfo(): ServerInfo {
		return this.serverInfo;
	}

	public getMeshNode(): MeshNode | null {
		return this.meshNode;
	}

	/**
	 * Injects data into the secure sandbox context for Logic-on-Origin tools.
	 */
	public setSandboxData(records: Record<string, unknown>[]) {
		this.sandboxRecords = records;
	}

	public getBoundPort(): number | null {
		return this.boundPort;
	}

	/**
	 * Connects to the libp2p Kademlia DHT and announces capabilities.
	 * Boots the gRPC server for secure Logic-on-Origin.
	 */
	public async connectToMesh(
		options: { port?: number; meshConfig?: MeshNodeConfig } = {},
	): Promise<void> {
		const envPort = process.env.LIOP_GRPC_PORT
			? Number.parseInt(process.env.LIOP_GRPC_PORT, 10)
			: undefined;
		const port = options.port ?? envPort ?? 50051;

		// [Fail-Fast] Validate tokenSlug format at startup to prevent silent mismatches
		const TOKEN_SLUG_PATTERN = /^[A-Z][A-Z0-9_]*$/;
		if (
			this.config?.tokenSlug &&
			!TOKEN_SLUG_PATTERN.test(this.config.tokenSlug)
		) {
			throw new Error(
				`Invalid tokenSlug "${this.config.tokenSlug}". Must match SCREAMING_SNAKE_CASE: /^[A-Z][A-Z0-9_]*$/ (e.g., "BANK", "VAULT", "HFT_ORACLE").`,
			);
		}

		// 1. Initialize Mesh Node (Discovery)
		this.meshNode = new MeshNode(options.meshConfig);
		await this.meshNode.start();

		// 2. Register LIOP Manifest Protocol Handler
		// This allows remote peers to query our tool/resource metadata dynamically.
		const meshNodeRef = this.meshNode;
		this.meshNode.registerManifestHandler((): LiopManifest => {
			const tools = this.listTools().map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema as Record<string, unknown>,
			}));

			const resources = Array.from(this.resources.values()).map((r) => ({
				name: r.name,
				uri: r.uri,
				description: r.description,
				mimeType: r.mimeType,
				text: typeof r.content === "string" ? r.content : r.description,
			}));

			const unsignedManifest: LiopManifest = {
				peerId: meshNodeRef.getPeerId(),
				grpcPort: port,
				tools,
				resources,
				serverInfo: this.serverInfo,
				authRequired: this.jwtValidator !== undefined,
				tokenSlug: this.config?.tokenSlug,
				taxonomy: this.config?.taxonomy
					? {
							domain: this.config.taxonomy.domain || "Unknown Domain",
							clearanceTier: this.config.taxonomy.clearanceTier ?? 0,
							executionTypes: this.config.taxonomy.executionTypes || [],
						}
					: undefined,
			};

			const attestation = Dilithium65Wrapper.signManifest(
				unsignedManifest as unknown as Record<string, unknown>,
				this.pqcKeyPair.secretKey,
				this.pqcKeyPair.publicKey,
			);

			return {
				...unsignedManifest,
				pqcSignature: attestation.signature,
				pqcPublicKey: attestation.publicKey,
			};
		});

		// 3. Announce local tools to the DHT
		for (const tool of this.listTools()) {
			await this.meshNode.announceCapability(tool.name).catch(log.info);
		}

		// 4. Announce manifest availability
		await this.meshNode.announceManifest().catch(log.info);

		// 5. Initialize gRPC Server (Execution)
		this.rpcServer = new LiopRpcServer();

		this.rpcServer.addService({
			negotiateIntent: (call, callback) => {
				const request = call.request;
				log.info(
					`[LIOP-RPC] Negotiating intent for capability: ${request.capability_hash}`,
				);

				if (this.jwtValidator) {
					const authHeader = call.metadata.get("authorization")[0] as
						| string
						| undefined;
					if (!authHeader) {
						callback({
							code: grpc.status.UNAUTHENTICATED,
							details: "Missing Authorization header in gRPC metadata",
						});
						return;
					}

					const token = authHeader.startsWith("Bearer ")
						? authHeader.slice(7)
						: authHeader;

					// Calculate SHA-256 hash of the incoming token
					const tokenHash = crypto
						.createHash("sha256")
						.update(token)
						.digest("hex")
						.toLowerCase();

					// 1. Check local revocation list
					this.loadRevocationList();
					if (this.revokedTokenHashes.has(tokenHash)) {
						callback({
							code: grpc.status.UNAUTHENTICATED,
							details: "Token has been revoked by the resource owner",
						});
						return;
					}

					// 2. Validate Pre-Shared Local Access Token (Sovereign Node Auth)
					const localTestToken = this.config?.auth?.localTestToken;
					const isTestTokenPattern = /^[a-zA-Z0-9_-]+-local-test-token$/;

					if (localTestToken) {
						if (token === localTestToken) {
							log.info(
								`[LIOP-RPC] Bypass authentication for matching localTestToken: ${localTestToken}`,
							);
							import("../rpc/crypto/kyber.js").then(
								async ({ Kyber768Wrapper }) => {
									const { publicKey, secretKey } =
										await Kyber768Wrapper.generateKeyPair();

									const sessionToken = crypto.randomUUID();

									this.sessions.set(sessionToken, {
										capability_hash: request.capability_hash,
										kyber_sk: secretKey,
										agent_did: request.agent_did,
										tokenHash,
										createdAt: Date.now(),
									});

									callback(null, {
										accepted: true,
										session_token: sessionToken,
										error_message: "",
										kyber_public_key: publicKey,
									});
								},
							);
							return;
						}

						// Strictly require the specific static access token
						callback({
							code: grpc.status.PERMISSION_DENIED,
							details:
								token && isTestTokenPattern.test(token)
									? "Pre-shared local test token is invalid for this resource domain (segregation violation)."
									: "Access Denied: This restricted node requires its specific static access token.",
						});
						return;
					}

					this.jwtValidator
						.validate(token)
						.then((authInfo) => {
							const authResult = authorizeRequest("tools/call", authInfo);
							if (!authResult.allowed) {
								callback({
									code: grpc.status.PERMISSION_DENIED,
									details: authResult.reason || "Access Denied",
								});
								return;
							}

							import("../rpc/crypto/kyber.js").then(
								async ({ Kyber768Wrapper }) => {
									const { publicKey, secretKey } =
										await Kyber768Wrapper.generateKeyPair();

									const sessionToken = crypto.randomUUID();

									this.sessions.set(sessionToken, {
										capability_hash: request.capability_hash,
										kyber_sk: secretKey,
										agent_did: request.agent_did,
										tokenHash,
										createdAt: Date.now(),
									});

									callback(null, {
										accepted: true,
										session_token: sessionToken,
										error_message: "",
										kyber_public_key: publicKey,
									});
								},
							);
						})
						.catch((err) => {
							callback({
								code: grpc.status.UNAUTHENTICATED,
								details: `Invalid JWT token: ${err.message}`,
							});
						});
				} else {
					import("../rpc/crypto/kyber.js").then(async ({ Kyber768Wrapper }) => {
						const { publicKey, secretKey } =
							await Kyber768Wrapper.generateKeyPair();

						const sessionToken = crypto.randomUUID();

						this.sessions.set(sessionToken, {
							capability_hash: request.capability_hash,
							kyber_sk: secretKey,
							agent_did: request.agent_did,
							createdAt: Date.now(),
						});

						callback(null, {
							accepted: true,
							session_token: sessionToken,
							error_message: "",
							kyber_public_key: publicKey,
						});
					});
				}
			},
			executeLogic: async (
				call: grpc.ServerWritableStream<LogicRequest, LogicResponse>,
			) => {
				const request = call.request;
				log.info(
					`[LIOP-RPC] Executing Logic-on-Origin for session: ${request.session_token}`,
				);

				const proceed = async () => {
					const session = this.sessions.get(request.session_token);
					if (!session) {
						call.emit("error", {
							code: grpc.status.UNAUTHENTICATED,
							details: "Invalid session token",
						});
						return;
					}

					// [PQC Security] Enforce Strict 1-Hour Session Lifetime (NIST SP 800-53 / PCI-DSS)
					const MAX_SESSION_KEY_LIFETIME_MS = 3600 * 1000;
					if (session.createdAt) {
						const sessionAge = Date.now() - session.createdAt;
						if (sessionAge > MAX_SESSION_KEY_LIFETIME_MS) {
							this.sessions.delete(request.session_token);
							call.emit("error", {
								code: grpc.status.UNAUTHENTICATED,
								details: `[LIOP-PQC] Session secret expired: Age (${Math.round(sessionAge / 1000)}s) exceeds 3600s TTL limit. Re-handshake required.`,
							});
							return;
						}
					}

					// Verify if the token associated with this session has been revoked in the meantime
					if (session.tokenHash) {
						this.loadRevocationList();
						if (this.revokedTokenHashes.has(session.tokenHash)) {
							call.emit("error", {
								code: grpc.status.UNAUTHENTICATED,
								details: "Token has been revoked by the resource owner",
							});
							return;
						}
					}

					// [SECURITY] Resolve the negotiated tool to enforce its policies
					const toolName = session.capability_hash;
					const toolDef = toolName ? this.tools.get(toolName) : undefined;
					const toolPolicy = toolDef?.policy;

					// [SECURITY] Preflight check on gRPC execution path (decrypt Logic-on-Origin)
					try {
						const kem = await createMlKem768();
						const sharedSecret = kem.decap(
							new Uint8Array(request.pqc_ciphertext),
							session.kyber_sk,
						);
						const aesKey = Buffer.from(sharedSecret);

						const wasmBuffer = Buffer.from(request.wasm_binary);
						const authTag = wasmBuffer.subarray(-16);
						const encryptedData = wasmBuffer.subarray(0, -16);

						const decipher = crypto.createDecipheriv(
							"aes-256-gcm",
							aesKey,
							Buffer.from(request.aes_nonce || new Uint8Array(12)),
						);
						decipher.setAuthTag(authTag);
						let decrypted = decipher.update(encryptedData);
						decrypted = Buffer.concat([decrypted, decipher.final()]);

						const decryptedPayload = decrypted.toString("utf-8");
						const logic =
							this.extractLogic(decryptedPayload) || decryptedPayload.trim();

						const preflightReason = this.runPreflightPolicy(
							toolName || "unknown_tool",
							logic,
							toolPolicy,
							session.agent_did || request.session_token,
						);

						if (preflightReason) {
							log.info(`[LIOP-RPC] Preflight blocked: ${preflightReason}`);
							const errorResponse: LogicResponse = {
								semantic_evidence: preflightReason,
								cryptographic_proof: Buffer.from(""),
								zk_receipt: Buffer.from(""),
								is_error: true,
							};
							call.write(errorResponse, () => {
								call.end();
							});
							return;
						}
					} catch (decryptionError: unknown) {
						const errorMsg =
							decryptionError instanceof Error
								? decryptionError.message
								: String(decryptionError);
						log.error(`[LIOP-RPC] Preflight decryption failed: ${errorMsg}`);
						call.emit("error", {
							code: grpc.status.INTERNAL,
							details: `Preflight logic analysis failed: ${errorMsg}`,
						});
						return;
					}

					try {
						// [DP] Prepare Differential Privacy configuration from tool policy
						const dpConfig = toolPolicy
							? {
									epsilon: toolPolicy.dpEpsilon ?? 1.0,
									sensitivity: toolPolicy.dpSensitivity ?? 1.0,
									smallDatasetThreshold:
										toolPolicy.dpSmallDatasetThreshold ?? 50,
								}
							: undefined;

						// Pass to Worker Pool for PQC Decryption and WASI/V8 execution
						const workerResponse = await this.workerPool.run({
							ciphertext: request.pqc_ciphertext,
							secretKeyObj: Array.from(session.kyber_sk),
							wasmBinary: request.wasm_binary,
							inputs: request.inputs,
							aesNonce: request.aes_nonce,
							records: this.sandboxRecords,
							sessionToken: request.session_token,
							sessionTimestamp: session.createdAt,
							isEncrypted: true,
							dpConfig, // Apply DP noise inside worker before ZK-Receipt commitment
						});

						const sanitizedWorkerOutput = sanitizeOutput(workerResponse.output);

						let finalOutput: string;
						let validationOutput: unknown = sanitizedWorkerOutput;
						try {
							finalOutput =
								typeof sanitizedWorkerOutput === "string"
									? sanitizedWorkerOutput
									: JSON.stringify(sanitizedWorkerOutput);

							// [PROTOCOL TRANSFORMER] Support for Proxied Tool Calls
							const decoded = JSON.parse(finalOutput);
							if (decoded.__liop_proxy_tool) {
								log.info(
									`[LIOP-RPC] Executing Proxied Tool: ${decoded.__liop_proxy_tool}`,
								);
								const clientId = session.agent_did || "unknown-client";
								const toolResult = await this.callTool(
									{
										name: decoded.__liop_proxy_tool,
										arguments: decoded.__liop_proxy_args || {},
									},
									clientId,
								);

								if (toolResult.isError) {
									log.info(
										`[LIOP-RPC] Proxy tool execution failed: ${toolResult.content[0].text}`,
									);
									const errorResponse: LogicResponse = {
										semantic_evidence:
											toolResult.content[0].text || "Unknown error",
										cryptographic_proof: Buffer.from(""),
										zk_receipt: Buffer.from(""),
										is_error: true,
									};
									call.write(errorResponse, () => {
										call.end();
									});
									return;
								}

								const sanitizedToolResult = sanitizeOutput(toolResult);
								finalOutput = JSON.stringify(sanitizedToolResult);
								validationOutput =
									this.unwrapForAggregationPolicyScan(sanitizedToolResult);
							}
						} catch {
							finalOutput = String(sanitizedWorkerOutput);
						}

						// [SECURITY] Output Schema & Policy validation for gRPC Egress
						const policyViolation = this.validateOutputPolicy(
							toolName || "unknown_tool",
							validationOutput,
							toolPolicy,
						);
						if (policyViolation) {
							log.info(
								`[LIOP-RPC] Output policy blocked for ${toolName || "unknown_tool"}: ${policyViolation}`,
							);

							const isDev =
								process.env.NODE_ENV === "development" ||
								process.env.NODE_ENV === "test" ||
								process.env.LIOP_SEC_VERBOSE === "1";

							const errorMessage = isDev
								? policyViolation
								: "[LIOP] Egress Security Violation. Output blocked due to policy enforcement.";

							const errorResponse: LogicResponse = {
								semantic_evidence: errorMessage,
								cryptographic_proof: Buffer.from(""),
								zk_receipt: Buffer.from(""),
								is_error: true,
							};

							call.write(errorResponse, () => {
								call.end();
							});
							return;
						}

						const response: LogicResponse = {
							semantic_evidence: finalOutput,
							cryptographic_proof: Buffer.from(
								workerResponse.image_id || "",
								"hex",
							),
							zk_receipt: workerResponse.zk_receipt
								? Buffer.from(workerResponse.zk_receipt, "base64")
								: Buffer.from(""),
							is_error: false,
						};

						// Final PII check for gRPC egress
						const violation = await this.piiScanner.scan(validationOutput);
						const aggregationViolation = this.violatesAggregationFirstPolicy(
							this.unwrapForAggregationPolicyScan(validationOutput),
							toolPolicy?.enforceAggregationFirst,
							this.sandboxRecords?.length,
						);
						const isBlocked = Boolean(violation || aggregationViolation);
						if (isBlocked) {
							// SEC-CRITICAL: Log details server-side, never expose to caller
							const internalReason =
								violation || "Aggregation-First Policy Violation";
							log.info(
								`[LIOP-RPC] Secure egress blocked in gRPC stream: ${internalReason}`,
							);
							response.semantic_evidence =
								"[LIOP] Egress Security Violation. Output blocked due to policy enforcement.";
							response.is_error = true;

							egressBlocksTotal.inc({
								reason: violation ? "pii_scanner" : "aggregation_policy",
							});
						}

						// [Phase Beta-3] SOC 2 Type II & HIPAA Immutable Audit Trail
						this.auditLogger.recordExecution({
							agentDid: session.agent_did || "unknown",
							peerId: session.tokenHash || "unknown",
							toolName: toolName || "unknown",
							datasetHash: this.getDatasetHash(),
							fuelConsumed: workerResponse.fuel_consumed || 0,
							outputHash: crypto
								.createHash("sha256")
								.update(response.semantic_evidence)
								.digest("hex"),
							zkReceiptSig: workerResponse.zk_receipt || "",
							status: isBlocked ? "BLOCKED_EGRESS" : "SUCCESS",
						});

						toolCallsTotal.inc({
							tool: toolName || "unknown",
							status: isBlocked ? "blocked_egress" : "success",
						});
						fuelConsumed.observe(
							{ tool: toolName || "unknown" },
							workerResponse.fuel_consumed || 0,
						);

						call.write(response, () => {
							call.end();
						});
					} catch (error: unknown) {
						const e = error as Error;
						const isDev =
							process.env.NODE_ENV === "development" ||
							process.env.NODE_ENV === "test";

						const detail = e.message || String(error);
						log.error(`[LIOP-RPC] Execution Error: ${detail}`);

						const errorMessage = isDev
							? `Execution Error: ${detail}`
							: "[LIOP] Execution Failed. The injected logic violated runtime constraints or encountered a fatal error.";

						this.auditLogger.recordExecution({
							agentDid: session.agent_did || "unknown",
							peerId: session.tokenHash || "unknown",
							toolName: toolName || "unknown",
							datasetHash: this.getDatasetHash(),
							fuelConsumed: 0,
							outputHash: crypto
								.createHash("sha256")
								.update(errorMessage)
								.digest("hex"),
							zkReceiptSig: "",
							status: "ERROR",
						});

						toolCallsTotal.inc({
							tool: toolName || "unknown",
							status: "error",
						});

						// Send error response before closing, avoiding "stream closed without results"
						const errorResponse: LogicResponse = {
							semantic_evidence: errorMessage,
							cryptographic_proof: Buffer.from(""),
							zk_receipt: Buffer.from(""),
							is_error: true,
						};

						try {
							call.write(errorResponse, () => {
								call.end();
							});
						} catch (_writeErr) {
							call.end();
						}
					}
				};

				if (this.jwtValidator) {
					const authHeader = call.metadata.get("authorization")[0] as
						| string
						| undefined;
					if (!authHeader) {
						call.emit("error", {
							code: grpc.status.UNAUTHENTICATED,
							details: "Missing Authorization header in gRPC metadata",
						});
						return;
					}

					const token = authHeader.startsWith("Bearer ")
						? authHeader.slice(7)
						: authHeader;

					const tokenHash = crypto
						.createHash("sha256")
						.update(token)
						.digest("hex")
						.toLowerCase();

					// 1. Check local revocation list
					this.loadRevocationList();
					if (this.revokedTokenHashes.has(tokenHash)) {
						call.emit("error", {
							code: grpc.status.UNAUTHENTICATED,
							details: "Token has been revoked by the resource owner",
						});
						return;
					}

					// 2. Validate Pre-Shared Local Access Token (Sovereign Node Auth)
					const localTestToken = this.config?.auth?.localTestToken;
					const isTestTokenPattern = /^[a-zA-Z0-9_-]+-local-test-token$/;

					if (localTestToken) {
						if (token === localTestToken) {
							log.info(
								`[LIOP-RPC] Bypass authentication in executeLogic for matching localTestToken: ${localTestToken}`,
							);
							await proceed();
							return;
						}

						// Strictly require the specific static access token
						call.emit("error", {
							code: grpc.status.PERMISSION_DENIED,
							details:
								token && isTestTokenPattern.test(token)
									? "Pre-shared local test token is invalid for this resource domain (segregation violation)."
									: "Access Denied: This restricted node requires its specific static access token.",
						});
						return;
					}

					try {
						const authInfo = await this.jwtValidator.validate(token);
						const authResult = authorizeRequest("tools/call", authInfo);
						if (!authResult.allowed) {
							call.emit("error", {
								code: grpc.status.PERMISSION_DENIED,
								details: authResult.reason || "Access Denied",
							});
							return;
						}
						await proceed();
					} catch (err: unknown) {
						call.emit("error", {
							code: grpc.status.UNAUTHENTICATED,
							details: `Invalid JWT token: ${
								err instanceof Error ? err.message : String(err)
							}`,
						});
					}
				} else {
					await proceed();
				}
			},
		});

		this.boundPort = await this.rpcServer.listen(port);
		log.info(
			`[LIOP-SDK] Node successfully announced to Mesh. PeerID: ${this.meshNode.getPeerId()}`,
		);
	}

	/**
	 * Internal worker execution with Egress Filtering logic.
	 */
	private async executeInWorkerPool(
		_args: Record<string, unknown>,
		rawPayload: string,
		toolName?: string,
	): Promise<CallToolResult> {
		try {
			// [DP] Prepare Differential Privacy configuration
			const dpPolicy = toolName ? this.tools.get(toolName)?.policy : undefined;
			const dpConfig = dpPolicy
				? {
						epsilon: dpPolicy.dpEpsilon ?? 1.0,
						sensitivity: dpPolicy.dpSensitivity ?? 1.0,
						smallDatasetThreshold: dpPolicy.dpSmallDatasetThreshold ?? 50,
					}
				: undefined;

			// Transparent local execution without dynamic PQC
			const workerResponse = await this.workerPool.run({
				ciphertext: new Uint8Array(0),
				secretKeyObj: Array.from(new Uint8Array(0)),
				kyberPublicKey: new Uint8Array(0),
				wasmBinary: Buffer.from(rawPayload),
				inputs: {},
				records: this.sandboxRecords,
				sessionToken: "local-dev-token",
				isEncrypted: false, // Use plaintext for local Logic-on-Origin injection
				dpConfig, // Pass DP Config to apply inside worker before ZK-Receipt commitment
			});

			// DP is now applied directly inside the worker to ensure ZK-Receipt integrity
			const dpOutput = workerResponse.output;
			const sanitizedOutput = sanitizeOutput(dpOutput);

			// Standard MCP Content Array
			const textOutput = JSON.stringify({
				computation_result: sanitizedOutput,
				image_id: workerResponse.image_id,
				zk_receipt: workerResponse.zk_receipt,
				status: "Worker Pool Execution Success",
			});

			const content = [
				{
					type: "text" as const,
					text: textOutput,
				},
			];

			const toolPolicy = toolName
				? this.tools.get(toolName)?.policy
				: undefined;
			const policyViolation = this.validateOutputPolicy(
				toolName || "unknown_tool",
				sanitizedOutput, // Phase 109: Validate NOISY output to ensure invariants
				toolPolicy,
			);
			if (policyViolation) {
				// SEC-CRITICAL: Log details server-side, never expose to caller in Production
				log.info(
					`[LIOP-SDK] Output policy blocked for ${toolName || "unknown_tool"}: ${policyViolation}`,
				);

				const isDev =
					process.env.NODE_ENV === "development" ||
					process.env.NODE_ENV === "test" ||
					process.env.LIOP_SEC_VERBOSE === "1";

				const errorMessage = isDev
					? policyViolation
					: "[LIOP] Egress Security Violation. Output blocked due to policy enforcement. Ensure your logic uses strictly aggregated, non-PII patterns.";

				return {
					content: [
						{
							type: "text",
							text: errorMessage,
						},
					],
					isError: true,
				};
			}

			// Professional PII Protection Guard
			const violation = await this.piiScanner.scan(sanitizedOutput);
			const aggregationViolation = this.violatesAggregationFirstPolicy(
				sanitizedOutput, // Phase 109: Validate NOISY output
				toolPolicy?.enforceAggregationFirst,
				this.sandboxRecords?.length,
			);
			if (violation || aggregationViolation) {
				// SEC-CRITICAL: Log the specific violation reason server-side only.
				// Never expose detection details (entity names, matched values) to the caller in Production.
				const internalReason =
					violation ||
					"Aggregation-First Policy Violation: Output blocked due to dynamic flat-key policy enforcement.";
				log.info(
					`[LIOP-SDK] Secure egress blocked in local execution: ${internalReason}`,
				);

				const isDev =
					process.env.NODE_ENV === "development" ||
					process.env.NODE_ENV === "test" ||
					process.env.LIOP_SEC_VERBOSE === "1";

				const errorMessage = isDev
					? `[LIOP] Egress Security Violation: ${internalReason}`
					: "[LIOP] Egress Security Violation. Output blocked due to policy enforcement. Ensure your logic uses strictly aggregated, non-PII patterns.";

				return {
					content: [
						{
							type: "text",
							text: errorMessage,
						},
					],
					isError: true,
				};
			}

			return { content };
		} catch (error: unknown) {
			const e = error as Error;
			const isDev =
				process.env.NODE_ENV === "development" ||
				process.env.NODE_ENV === "test" ||
				process.env.LIOP_SEC_VERBOSE === "1";

			const detail = e.message || String(error);
			log.error(`[LIOP-SDK] WorkerPool Execution Fault: ${detail}`);

			// [OOM Hardening] Detect V8 worker termination due to heap limit
			const isOom =
				detail.includes("worker_thread_exited") ||
				detail.includes("ERR_WORKER_OUT_OF_MEMORY") ||
				detail.includes("terminated") ||
				detail.includes("heap limit");

			const errorMessage = isOom
				? "[LIOP] Execution terminated: memory limit exceeded (64MB heap). Reduce data processing volume."
				: isDev
					? `WorkerPoolError: ${detail}`
					: "[LIOP] Execution Failed. The injected logic violated runtime constraints or encountered a fatal error.";

			return {
				content: [
					{
						type: "text",
						text: errorMessage,
					},
				],
				isError: true,
			};
		}
	}

	/**
	 * Safely destroys the worker pool, gRPC server, and Mesh node.
	 * Recommended to be called during graceful shutdowns or test teardowns.
	 */
	public async close(): Promise<void> {
		if (this.workerPool) {
			await this.workerPool.close({ force: true });
		}
		if (this.rpcServer) {
			await this.rpcServer.stop();
		}
		if (this.meshNode) {
			await this.meshNode.stop();
		}
	}

	private loadRevocationList(): void {
		const rPath = this.config?.auth?.revocationPath;
		if (!rPath) return;

		try {
			if (fs.existsSync(rPath)) {
				const stats = fs.statSync(rPath);
				// If file has not changed since last load, skip reading
				if (stats.mtimeMs <= this.lastRevocationLoadTime) {
					return;
				}

				const content = fs.readFileSync(rPath, "utf-8");
				const list = JSON.parse(content);
				if (Array.isArray(list)) {
					this.revokedTokenHashes.clear();
					for (const item of list) {
						if (typeof item === "string") {
							this.revokedTokenHashes.add(item.trim().toLowerCase());
						}
					}
					this.lastRevocationLoadTime = stats.mtimeMs;
					log.info(
						`[LiopServer] Loaded ${this.revokedTokenHashes.size} revoked token hashes from ${rPath}`,
					);
				}
			} else {
				// Initialize an empty revocation list file
				const dir = path.dirname(rPath);
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
				}
				fs.writeFileSync(rPath, JSON.stringify([], null, 2), "utf-8");
				this.lastRevocationLoadTime = Date.now();
				log.info(
					`[LiopServer] Created empty local revocation list at ${rPath}`,
				);
			}
		} catch (err: unknown) {
			log.error(
				`[LiopServer] Failed to load revocation list: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}

	public revokeToken(token: string): void {
		if (!token) return;
		const hash = crypto
			.createHash("sha256")
			.update(token)
			.digest("hex")
			.toLowerCase();
		this.revokeTokenHash(hash);
	}

	public revokeTokenHash(hash: string): void {
		if (!hash) return;
		const normalizedHash = hash.toLowerCase();

		this.loadRevocationList();
		this.revokedTokenHashes.add(normalizedHash);

		const rPath = this.config?.auth?.revocationPath;
		if (rPath) {
			try {
				const dir = path.dirname(rPath);
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
				}
				const hashes = Array.from(this.revokedTokenHashes);
				fs.writeFileSync(rPath, JSON.stringify(hashes, null, 2), "utf-8");

				const stats = fs.statSync(rPath);
				this.lastRevocationLoadTime = stats.mtimeMs;

				log.info(
					`[LiopServer] Persisted revocation for hash ${normalizedHash} to ${rPath}`,
				);
			} catch (err: unknown) {
				log.error(
					`[LiopServer] Failed to persist revocation: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}

	/**
	 * Resets the query budget for a specific client identity.
	 * If toolName is provided, only that tool's budget is cleared.
	 * Otherwise, all tool budgets for the client are reset.
	 *
	 * Operates on both in-memory and persistent (disk) budget stores.
	 * Uses file-level locking for safe concurrent access.
	 */
	public resetFieldBudget(clientId: string, toolName?: string): void {
		// Guard against prototype pollution attacks (CWE-915 / js/prototype-polluting-assignment)
		if (
			clientId === "__proto__" ||
			clientId === "constructor" ||
			clientId === "prototype" ||
			(toolName &&
				(toolName === "__proto__" ||
					toolName === "constructor" ||
					toolName === "prototype"))
		) {
			log.warn(
				`[LiopServer] Rejected resetFieldBudget for unsafe clientId/toolName: ${clientId}`,
			);
			return;
		}

		// 1. Clear in-memory budget
		if (toolName) {
			const clientBudget = this.fieldQueryBudget.get(clientId);
			if (clientBudget) {
				clientBudget.delete(toolName);
			}
		} else {
			this.fieldQueryBudget.delete(clientId);
		}

		// 2. Clear persistent budget (if configured)
		const storePath = this.config?.budgetStorePath;
		if (storePath) {
			try {
				this.executeWithBudgetLock(storePath, (budget) => {
					if (toolName) {
						if (Object.hasOwn(budget, clientId) && budget[clientId]) {
							delete budget[clientId][toolName];
						}
					} else if (Object.hasOwn(budget, clientId)) {
						delete budget[clientId];
					}
					return { result: undefined, updatedBudget: budget };
				});
				log.info(
					`[LiopServer] Reset query budget for client ${clientId}${toolName ? ` / tool ${toolName}` : ""}`,
				);
			} catch (err: unknown) {
				log.error(
					`[LiopServer] Failed to reset persistent budget: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}

	private getPersistentBudget(
		storePath: string,
	): Record<string, Record<string, Record<string, number>>> {
		try {
			if (!fs.existsSync(storePath)) {
				return Object.create(null);
			}
			const content = fs.readFileSync(storePath, "utf-8");
			const parsed = JSON.parse(content || "{}");
			if (parsed && typeof parsed === "object") {
				const clean = Object.create(null);
				for (const [k, v] of Object.entries(parsed)) {
					if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
						clean[k] = v;
					}
				}
				return clean;
			}
			return Object.create(null);
		} catch {
			return Object.create(null);
		}
	}

	private savePersistentBudget(
		storePath: string,
		budget: Record<string, Record<string, Record<string, number>>>,
	): void {
		const tempPath = `${storePath}.tmp`;
		const dir = path.dirname(storePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(tempPath, JSON.stringify(budget, null, 2), "utf-8");
		fs.renameSync(tempPath, storePath);
	}

	private executeWithBudgetLock<T>(
		storePath: string,
		action: (
			budget: Record<string, Record<string, Record<string, number>>>,
		) => {
			result: T;
			updatedBudget?: Record<string, Record<string, Record<string, number>>>;
		},
	): T {
		const lockPath = `${storePath}.lock`;
		const maxRetries = 100;
		const delayMs = 15;
		let attempts = 0;

		const dir = path.dirname(storePath);
		if (!fs.existsSync(dir)) {
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch {
				// Ignore concurrent directory creation
			}
		}

		while (attempts < maxRetries) {
			try {
				fs.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
				break;
			} catch (e: unknown) {
				if (
					e &&
					typeof e === "object" &&
					"code" in e &&
					(e as Record<string, unknown>).code === "EEXIST"
				) {
					attempts++;
					const jitter = Math.floor(Math.random() * 10);
					const targetTime = Date.now() + delayMs + jitter;
					while (Date.now() < targetTime) {
						// Sync spin wait
					}
				} else {
					throw e;
				}
			}
		}

		if (attempts >= maxRetries) {
			throw new Error(
				"Timeout acquiring lock for persistent query budget database",
			);
		}

		try {
			const currentBudget = this.getPersistentBudget(storePath);
			const { result, updatedBudget } = action(currentBudget);
			if (updatedBudget) {
				this.savePersistentBudget(storePath, updatedBudget);
			}
			return result;
		} finally {
			try {
				if (fs.existsSync(lockPath)) {
					fs.unlinkSync(lockPath);
				}
			} catch {
				// Ignore lock removal errors
			}
		}
	}

	private applyInMemoryBudget(
		clientId: string,
		_toolName: string,
		extractedFields: string[],
		policy?: LogicExecutionPolicy,
	): string | null {
		let clientBudget = this.fieldQueryBudget.get(clientId);
		if (!clientBudget) {
			clientBudget = new Map<string, Map<string, number>>();
			this.fieldQueryBudget.set(clientId, clientBudget);
		}

		let toolBudget = clientBudget.get(_toolName);
		if (!toolBudget) {
			toolBudget = new Map<string, number>();
			clientBudget.set(_toolName, toolBudget);
		}

		for (const field of extractedFields) {
			const sensitivity = this.taintAnalyzer.classifyField(
				field,
				policy?.sensitiveKeys,
			);

			let queryLimit = 25; // default public
			let sensLabel = "public";

			if (policy?.queryBudgetPerField !== undefined) {
				queryLimit = policy.queryBudgetPerField;
				sensLabel = "override";
			} else if (sensitivity === "forbidden") {
				queryLimit = 3;
				sensLabel = "forbidden";
			} else if (sensitivity === "sensitive") {
				queryLimit = 8;
				sensLabel = "sensitive";
			}

			const count = toolBudget.get(field) ?? 0;
			if (count >= queryLimit) {
				return `Preflight policy rejected: Query budget exceeded for field '${field}' (max ${queryLimit} per session for ${sensLabel} fields). Rotate PQC session to reset budget.`;
			}
		}

		for (const field of extractedFields) {
			const count = toolBudget.get(field) ?? 0;
			toolBudget.set(field, count + 1);
		}

		return null;
	}
}
