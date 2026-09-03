/**
 * LIOP Taint Analyzer — Static Information Flow Control (IFC)
 *
 * Performs AST-level taint tracking on injected Logic-on-Origin code
 * to detect side-channel data exfiltration via scalar derivation
 * (charCodeAt, boolean inference, arithmetic on PII fields).
 *
 * Architecture: 3-pass analysis using Acorn ESTree parser.
 *   Pass 1 — Identify record-bound variables (callback params of env.records methods)
 *   Pass 2 — Propagate taint through assignments and expressions
 *   Pass 3 — Check return statements for tainted values flowing to output
 *
 * References:
 *   - Acorn ESTree spec: https://github.com/estree/estree
 *   - Acorn-Walk SimpleVisitors: https://github.com/acornjs/acorn/tree/master/acorn-walk
 *   - OWASP Information Flow Control patterns
 */

import * as acorn from "acorn";
import { type SimpleVisitors, simple } from "acorn-walk";

// ── Public API ───────────────────────────────────────────────────────

export type FieldSensitivity = "forbidden" | "sensitive" | "public";

export interface TaintViolation {
	/** Human-readable reason for the block */
	reason: string;
	/** Source line number (1-indexed) if available */
	line?: number;
	/** The specific operation that triggered the violation */
	operation?: string;
}

/**
 * Static taint analyzer for LIOP Logic-on-Origin payloads.
 *
 * Detects when PII field values are derived into scalar outputs
 * (charCodeAt, boolean inference, arithmetic) that would bypass
 * the Egress Shield's pattern-based detection.
 */
export class TaintAnalyzer {
	private readonly piiFields: Set<string>;
	private readonly sensitiveKeys: Set<string>;

	/** String methods that extract character-level information from PII */
	private static readonly TAINT_PROPAGATING_METHODS = new Set([
		// Character extraction
		"charCodeAt",
		"codePointAt",
		"charAt",
		"at",
		// Search/position (reveals content structure)
		"indexOf",
		"lastIndexOf",
		"search",
		// Comparison (reveals ordering/content)
		"localeCompare",
		"startsWith",
		"endsWith",
		"includes",
		// Transformation (preserves PII content in different form)
		"substring",
		"slice",
		"substr",
		"split",
		"match",
		"matchAll",
		"replace",
		"replaceAll",
		"normalize",
		"toLowerCase",
		"toUpperCase",
		"trim",
		"trimStart",
		"trimEnd",
		"padStart",
		"padEnd",
		"repeat",
	]);

	/** Array iteration methods whose callbacks receive individual records */
	private static readonly ARRAY_CALLBACK_METHODS = new Set([
		"map",
		"forEach",
		"filter",
		"find",
		"some",
		"every",
		"flatMap",
		"findIndex",
	]);

	/** Reduce-family methods where the record param is the SECOND callback arg */
	private static readonly REDUCE_METHODS = new Set(["reduce", "reduceRight"]);
	private readonly currentRecordCollections: Set<string> = new Set();

	constructor(piiFields: string[], sensitiveKeys: string[] = []) {
		this.piiFields = new Set(piiFields.map((f) => f.toLowerCase()));
		this.sensitiveKeys = new Set(sensitiveKeys.map((f) => f.toLowerCase()));
	}

	/**
	 * Classifies a field into forbidden, sensitive, or public tiers (NIST SP 800-226).
	 */
	classifyField(
		field: string,
		policySensitiveKeys: string[] = [],
	): FieldSensitivity {
		const lowerField = field.toLowerCase();
		if (this.piiFields.has(lowerField)) {
			return "forbidden";
		}

		const lowerPolicyKeys = new Set(
			policySensitiveKeys.map((k) => k.toLowerCase()),
		);
		if (this.sensitiveKeys.has(lowerField) || lowerPolicyKeys.has(lowerField)) {
			return "sensitive";
		}

		return "public";
	}

	/**
	 * Analyzes injected source code for PII taint violations.
	 *
	 * @param sourceCode - The raw JavaScript logic extracted from the LIOP envelope
	 * @param recordCount - Size of source dataset (enables correlation/min-max gates for small sets)
	 * @param minMaxBlockThreshold - Threshold below which extrema/correlation extraction is blocked
	 * @returns A TaintViolation if PII-derived values flow to output, null if clean
	 */
	analyze(
		sourceCode: string,
		recordCount?: number,
		minMaxBlockThreshold: number = 50,
	): TaintViolation | null {
		let ast: acorn.Node;
		try {
			// Wrap in function body to handle bare `return` statements
			const wrapped = `function liop_analysis_wrapper(env) {\n${sourceCode}\n}`;
			ast = acorn.parse(wrapped, {
				ecmaVersion: 2022,
				sourceType: "script",
				locations: true,
			});
		} catch {
			// Syntax errors are handled downstream by the sandbox VM
			return null;
		}

		const recordBoundVars = new Set<string>();
		const taintedVars = new Set<string>();

		// Pass 1: Identify variables bound to individual records
		this.identifyRecordBoundVars(ast, recordBoundVars);

		// Pass 2: Propagate taint through variable assignments
		this.propagateTaint(ast, recordBoundVars, taintedVars);

		// Pass 3: Check if any return statement contains tainted values
		const taintResult = this.checkReturnStatements(
			ast,
			recordBoundVars,
			taintedVars,
		);
		if (taintResult) return taintResult;

		// Pass 4: Correlation Guard — detect multiple reduce on same field (F-01)
		if (
			recordCount !== undefined &&
			recordCount > 0 &&
			recordCount < minMaxBlockThreshold
		) {
			const correlationResult = this.detectCorrelatedAggregations(ast);
			if (correlationResult) {
				// Augment error with the actual threshold for clarity (Phase 109 requirement)
				correlationResult.reason = correlationResult.reason.replace(
					"50 records",
					`${minMaxBlockThreshold} records`,
				);
				return correlationResult;
			}
		}

		// Pass 5: Min/Max Gate — block extrema extraction on small datasets (F-02)
		if (
			recordCount !== undefined &&
			recordCount > 0 &&
			recordCount < minMaxBlockThreshold
		) {
			const minMaxResult = this.detectMinMaxExtraction(ast);
			if (minMaxResult) {
				minMaxResult.reason = minMaxResult.reason.replace(
					"50 records",
					`${minMaxBlockThreshold} records`,
				);
				return minMaxResult;
			}
		}

		return null;
	}

	/**
	 * Extracts all unique field names accessed via env.records operations.
	 * Used by the Query Budget to enforce per-field query limits.
	 */
	extractQueriedFields(sourceCode: string): string[] {
		let ast: acorn.Node;
		try {
			ast = acorn.parse(`function w(env) {\n${sourceCode}\n}`, {
				ecmaVersion: 2022,
				sourceType: "script",
			});
		} catch {
			return [];
		}

		const recordBoundVars = new Set<string>();
		this.identifyRecordBoundVars(ast, recordBoundVars);

		const fields = new Set<string>();

		const visitors: SimpleVisitors<void> = {
			MemberExpression: (node) => {
				const propName = this.getPropertyName(node);
				if (!propName || propName === "length") return;

				// Case 1: r.field (direct property access on record-bound variable)
				if (
					node.object.type === "Identifier" &&
					recordBoundVars.has((node.object as acorn.Identifier).name)
				) {
					fields.add(propName);
				}

				// Case 2: env.records[N].field (direct index member access)
				if (node.object.type === "MemberExpression") {
					const parentMember = node.object as acorn.MemberExpression;
					if (
						parentMember.computed &&
						this.isEnvRecordsAccess(parentMember.object)
					) {
						fields.add(propName);
					}
				}
			},
		};

		simple(ast, visitors);
		return Array.from(fields);
	}

	// ── Pass 4: Correlation Guard ─────────────────────────────────────

	/**
	 * Detects when 2+ reduce/aggregation calls access the same field.
	 * This prevents differencing attacks: sum(all.field) - sum(excl1.field) = individual value.
	 * Exempt: .length access (metadata, not field access).
	 */
	private detectCorrelatedAggregations(ast: acorn.Node): TaintViolation | null {
		const fieldAggCounts = new Map<string, number>();

		const visitors: SimpleVisitors<void> = {
			CallExpression: (node) => {
				if (node.callee.type !== "MemberExpression") return;

				const callee = node.callee as acorn.MemberExpression;
				const methodName = this.getPropertyName(callee);

				// Only track reduce/reduceRight aggregations
				if (!methodName || !TaintAnalyzer.REDUCE_METHODS.has(methodName))
					return;

				// Must be called on env.records or a derivation of it (.slice(), .filter())
				if (!this.isEnvRecordsChain(callee.object)) return;

				// Extract the field name accessed in the callback
				const callback = node.arguments[0];
				if (
					!callback ||
					(callback.type !== "ArrowFunctionExpression" &&
						callback.type !== "FunctionExpression")
				)
					return;

				const fn = callback as acorn.ArrowFunctionExpression;
				const recordParam = fn.params.length > 1 ? fn.params[1] : fn.params[0];
				if (recordParam?.type !== "Identifier") return;

				const paramName = (recordParam as acorn.Identifier).name;
				const fields = this.extractFieldsFromBody(
					fn.body as acorn.Node,
					paramName,
				);

				for (const field of fields) {
					const current = fieldAggCounts.get(field) ?? 0;
					fieldAggCounts.set(field, current + 1);
				}
			},
		};

		simple(ast, visitors);

		for (const [field, count] of fieldAggCounts) {
			if (count >= 2) {
				return {
					reason:
						`Correlation guard: ${count} aggregations detected on field '${field}'. ` +
						"Multiple correlated aggregations on the same field can enable differencing attacks. " +
						"Use a single aggregation per numeric field, or increase dataset size above 50 records.",
				};
			}
		}

		return null;
	}

	/**
	 * Checks if a node is env.records or a chain like env.records.slice(N) / env.records.filter(...)
	 */
	private isEnvRecordsChain(node: acorn.Node): boolean {
		if (this.isEnvRecordsAccess(node)) return true;

		// Handle env.records.slice(N), env.records.filter(...)
		if (node.type === "CallExpression") {
			const call = node as acorn.CallExpression;
			if (call.callee.type === "MemberExpression") {
				const member = call.callee as acorn.MemberExpression;
				const method = this.getPropertyName(member);
				if (
					method &&
					(method === "slice" || method === "filter" || method === "toSorted")
				) {
					return this.isEnvRecordsChain(member.object);
				}
			}
		}

		// Handle [...env.records] (SpreadElement in ArrayExpression assigned to var)
		return false;
	}

	/** Checks if an expression resolves to env.records, records, an alias, or a derivation chain */
	private isRecordsSource(node: acorn.Node): boolean {
		if (this.isEnvRecordsAccess(node)) return true;
		if (
			node.type === "Identifier" &&
			this.currentRecordCollections.has((node as acorn.Identifier).name)
		) {
			return true;
		}
		if (node.type === "CallExpression") {
			const call = node as acorn.CallExpression;
			if (call.callee.type === "MemberExpression") {
				const member = call.callee as acorn.MemberExpression;
				const method = this.getPropertyName(member);
				if (
					method &&
					(method === "slice" ||
						method === "filter" ||
						method === "toSorted" ||
						method === "map" ||
						method === "concat")
				) {
					return this.isRecordsSource(member.object);
				}
			}
		}
		return false;
	}

	/** Gathers aliases and derivations of env.records (e.g. const accounts = env.records; const top5 = accounts.filter(...)) */
	private identifyRecordCollections(ast: acorn.Node): void {
		this.currentRecordCollections.clear();
		for (let pass = 0; pass < 3; pass++) {
			const aliasVisitors: SimpleVisitors<void> = {
				VariableDeclarator: (node) => {
					if (!node.init || node.id.type !== "Identifier") return;
					if (this.isRecordsSource(node.init)) {
						this.currentRecordCollections.add(node.id.name);
					}
				},
				AssignmentExpression: (node) => {
					if (node.left.type !== "Identifier") return;
					if (this.isRecordsSource(node.right)) {
						this.currentRecordCollections.add(
							(node.left as acorn.Identifier).name,
						);
					}
				},
			};
			simple(ast, aliasVisitors);
		}
	}

	/**
	 * Extracts field names accessed on a record parameter within a function body.
	 * e.g., in `(s, r) => s + r.balance`, extracts "balance".
	 * Ignores .length as it's metadata, not a field access.
	 */
	private extractFieldsFromBody(body: acorn.Node, paramName: string): string[] {
		const fields: string[] = [];

		const visitors: SimpleVisitors<void> = {
			MemberExpression: (node) => {
				if (
					node.object.type === "Identifier" &&
					(node.object as acorn.Identifier).name === paramName
				) {
					const prop = this.getPropertyName(node);
					// Exempt .length — it's array metadata, not a data field
					if (prop && prop !== "length") {
						fields.push(prop);
					}
				}
			},
		};

		simple(body, visitors);
		return fields;
	}

	// ── Pass 5: Min/Max Gate ──────────────────────────────────────────

	/**
	 * Detects Math.min/max and sort()[0] patterns that expose individual
	 * record values from small datasets.
	 */
	private detectMinMaxExtraction(ast: acorn.Node): TaintViolation | null {
		let violation: TaintViolation | null = null;

		const visitors: SimpleVisitors<void> = {
			CallExpression: (node) => {
				if (violation) return;

				// Pattern: Math.min(...env.records.map(r => r.field))
				// Pattern: Math.max(...env.records.map(r => r.field))
				if (node.callee.type === "MemberExpression") {
					const callee = node.callee as acorn.MemberExpression;
					if (
						callee.object.type === "Identifier" &&
						(callee.object as acorn.Identifier).name === "Math"
					) {
						const method = this.getPropertyName(callee);
						if (method === "min" || method === "max") {
							// Check if any argument is a spread of env.records.map
							if (
								node.arguments.some(
									(arg) =>
										arg.type === "SpreadElement" &&
										this.isRecordsMapCall(
											(arg as acorn.SpreadElement).argument,
										),
								)
							) {
								violation = {
									reason:
										`Min/Max gate: Math.${method}() on individual records blocked for small datasets (n < 50). ` +
										"Use avg/stddev/count for privacy-safe aggregations.",
								};
							}
						}
					}
				}
			},

			// Pattern: env.records.sort(...)[0].field or [...env.records].sort(...)[0].field
			MemberExpression: (node) => {
				if (violation) return;

				// Check for sort result indexed access: .sort(...)[0]
				if (node.computed && node.object.type === "CallExpression") {
					const call = node.object as acorn.CallExpression;
					if (call.callee.type === "MemberExpression") {
						const method = this.getPropertyName(
							call.callee as acorn.MemberExpression,
						);
						if (method === "sort" || method === "toSorted") {
							const sortTarget = (call.callee as acorn.MemberExpression).object;
							if (this.isEnvRecordsChain(sortTarget)) {
								violation = {
									reason:
										"Min/Max gate: .sort()[index] on individual records blocked for small datasets (n < 50). " +
										"Use avg/stddev/count for privacy-safe aggregations.",
								};
							}
						}
					}
				}
			},
		};

		simple(ast, visitors);
		return violation;
	}

	/**
	 * Checks if a node is env.records.map(callback) — used by Min/Max Gate.
	 */
	private isRecordsMapCall(node: acorn.Node): boolean {
		if (node.type !== "CallExpression") return false;
		const call = node as acorn.CallExpression;
		if (call.callee.type !== "MemberExpression") return false;
		const callee = call.callee as acorn.MemberExpression;
		const method = this.getPropertyName(callee);
		return method === "map" && this.isRecordsSource(callee.object);
	}

	// ── Pass 1: Record-Bound Variable Identification ──────────────────

	private identifyRecordBoundVars(
		ast: acorn.Node,
		recordBoundVars: Set<string>,
	): void {
		this.identifyRecordCollections(ast);

		const visitors: SimpleVisitors<void> = {
			CallExpression: (node) => {
				if (node.callee.type !== "MemberExpression") return;

				const member = node.callee as acorn.MemberExpression;
				const methodName = this.getPropertyName(member);
				if (!methodName) return;

				// Check if this is env.records.METHOD(callback) or alias.METHOD(callback)
				if (!this.isRecordsSource(member.object)) return;

				const callback = node.arguments[0];
				if (!callback) return;

				if (
					callback.type === "ArrowFunctionExpression" ||
					callback.type === "FunctionExpression"
				) {
					const fn = callback as acorn.ArrowFunctionExpression;

					if (
						TaintAnalyzer.ARRAY_CALLBACK_METHODS.has(methodName) &&
						fn.params.length > 0
					) {
						const param = fn.params[0];
						if (param.type === "Identifier") {
							recordBoundVars.add(param.name);
						}
					}

					if (
						TaintAnalyzer.REDUCE_METHODS.has(methodName) &&
						fn.params.length > 1
					) {
						const recordParam = fn.params[1];
						if (recordParam.type === "Identifier") {
							recordBoundVars.add(recordParam.name);
						}
					}
				}
			},

			// for (const r of env.records) or for (const r of accounts) → r is record-bound
			ForOfStatement: (node) => {
				if (!this.isRecordsSource(node.right)) return;

				if (node.left.type === "VariableDeclaration") {
					for (const declarator of node.left.declarations) {
						if (declarator.id.type === "Identifier") {
							recordBoundVars.add(declarator.id.name);
						}
					}
				}
			},
		};

		simple(ast, visitors);

		// Also handle: const r = env.records[N] or const r = accounts[N]
		const indexVisitors: SimpleVisitors<void> = {
			VariableDeclarator: (node) => {
				if (!node.init || node.id.type !== "Identifier") return;

				if (
					node.init.type === "MemberExpression" &&
					(node.init as acorn.MemberExpression).computed
				) {
					const member = node.init as acorn.MemberExpression;
					if (this.isRecordsSource(member.object)) {
						recordBoundVars.add(node.id.name);
					}
				}
			},
		};

		simple(ast, indexVisitors);
	}

	// ── Pass 2: Taint Propagation ─────────────────────────────────────

	private propagateTaint(
		ast: acorn.Node,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): void {
		// Multiple iterations to handle transitive taint chains
		// (e.g., const a = r.name; const b = a; const c = b.charCodeAt(0))
		for (let iteration = 0; iteration < 3; iteration++) {
			const sizeBefore = taintedVars.size;

			const visitors: SimpleVisitors<void> = {
				VariableDeclarator: (node) => {
					if (!node.init || node.id.type !== "Identifier") return;

					if (
						this.isExpressionTainted(node.init, recordBoundVars, taintedVars)
					) {
						taintedVars.add(node.id.name);
					}
				},

				AssignmentExpression: (node) => {
					// Handle computed property assignment with tainted property: acc[a.accountHolder] = ...
					if (node.left.type === "MemberExpression") {
						const member = node.left as acorn.MemberExpression;
						if (
							member.computed &&
							this.isExpressionTainted(
								member.property,
								recordBoundVars,
								taintedVars,
							)
						) {
							if (member.object.type === "Identifier") {
								taintedVars.add((member.object as acorn.Identifier).name);
							}
						}
					}

					if (node.left.type !== "Identifier") return;

					if (
						this.isExpressionTainted(node.right, recordBoundVars, taintedVars)
					) {
						taintedVars.add((node.left as acorn.Identifier).name);
					}
				},

				FunctionDeclaration: (node) => {
					if (node.id && node.id.type === "Identifier") {
						if (
							this.doesCallbackProduceTaint(
								node,
								null,
								recordBoundVars,
								taintedVars,
							)
						) {
							taintedVars.add(node.id.name);
						}
					}
				},

				// Imperative taint: array.push(taintedValue) contaminates the array
				// Covers for-of and forEach patterns that push PII-derived values
				CallExpression: (node) => {
					if (node.callee.type !== "MemberExpression") return;

					const callee = node.callee as acorn.MemberExpression;
					const methodName = this.getPropertyName(callee);

					if (
						methodName === "push" &&
						callee.object.type === "Identifier" &&
						node.arguments.some((arg) =>
							this.isExpressionTainted(arg, recordBoundVars, taintedVars),
						)
					) {
						taintedVars.add((callee.object as acorn.Identifier).name);
					}
				},
			};

			simple(ast, visitors);

			// Fixed point: stop if no new tainted vars discovered
			if (taintedVars.size === sizeBefore) break;
		}
	}

	// ── Pass 3: Return Statement Sink Detection ───────────────────────

	private checkReturnStatements(
		ast: acorn.Node,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): TaintViolation | null {
		let violation: TaintViolation | null = null;

		const visitors: SimpleVisitors<void> = {
			ReturnStatement: (node) => {
				if (violation) return; // Already found one

				if (!node.argument) return;

				if (
					this.isExpressionTainted(node.argument, recordBoundVars, taintedVars)
				) {
					const line = node.loc?.start.line
						? node.loc.start.line - 1 // Adjust for wrapper function offset
						: undefined;
					const operation = this.describeTaintSource(
						node.argument,
						recordBoundVars,
						taintedVars,
					);
					violation = {
						reason:
							`PII side-channel detected: output contains values derived from restricted fields. ` +
							`${operation ? `Operation: ${operation}. ` : ""}` +
							`Use only non-PII fields (e.g., numeric/date columns) for aggregations.`,
						line,
						operation,
					};
				}
			},
		};

		simple(ast, visitors);

		return violation;
	}

	// ── Core Taint Evaluation ─────────────────────────────────────────

	/**
	 * Recursively determines if an AST expression produces a tainted value.
	 * A value is tainted if it derives from a PII field on a record-bound variable.
	 */
	private isExpressionTainted(
		node: acorn.Node,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): boolean {
		switch (node.type) {
			case "Identifier":
				return taintedVars.has((node as acorn.Identifier).name);

			case "MemberExpression":
				return this.isMemberExprTainted(
					node as acorn.MemberExpression,
					recordBoundVars,
					taintedVars,
				);

			case "CallExpression":
				return this.isCallExprTainted(
					node as acorn.CallExpression,
					recordBoundVars,
					taintedVars,
				);

			case "YieldExpression": {
				const yieldNode = node as acorn.YieldExpression;
				return yieldNode.argument
					? this.isExpressionTainted(
							yieldNode.argument,
							recordBoundVars,
							taintedVars,
						)
					: false;
			}

			case "FunctionExpression":
			case "ArrowFunctionExpression": {
				const fn = node as
					| acorn.FunctionExpression
					| acorn.ArrowFunctionExpression;
				return this.doesCallbackProduceTaint(
					fn,
					null,
					recordBoundVars,
					taintedVars,
				);
			}

			case "BinaryExpression":
			case "LogicalExpression": {
				const bin = node as acorn.BinaryExpression;
				return (
					this.isExpressionTainted(bin.left, recordBoundVars, taintedVars) ||
					this.isExpressionTainted(bin.right, recordBoundVars, taintedVars)
				);
			}

			case "UnaryExpression": {
				const unary = node as acorn.UnaryExpression;
				return this.isExpressionTainted(
					unary.argument,
					recordBoundVars,
					taintedVars,
				);
			}

			case "ConditionalExpression": {
				const cond = node as acorn.ConditionalExpression;
				// If the test involves tainted values, the branch choice leaks info
				return (
					this.isExpressionTainted(cond.test, recordBoundVars, taintedVars) ||
					this.isExpressionTainted(
						cond.consequent,
						recordBoundVars,
						taintedVars,
					) ||
					this.isExpressionTainted(cond.alternate, recordBoundVars, taintedVars)
				);
			}

			case "ObjectExpression": {
				const obj = node as acorn.ObjectExpression;
				return obj.properties.some((prop) => {
					if (prop.type === "Property") {
						if (
							prop.computed &&
							this.isExpressionTainted(prop.key, recordBoundVars, taintedVars)
						) {
							return true;
						}
						return this.isExpressionTainted(
							prop.value,
							recordBoundVars,
							taintedVars,
						);
					}
					if (prop.type === "SpreadElement") {
						return this.isExpressionTainted(
							prop.argument,
							recordBoundVars,
							taintedVars,
						);
					}
					return false;
				});
			}

			case "ArrayExpression": {
				const arr = node as acorn.ArrayExpression;
				return arr.elements.some(
					(el) =>
						el !== null &&
						this.isExpressionTainted(el, recordBoundVars, taintedVars),
				);
			}

			case "TemplateLiteral": {
				const tmpl = node as acorn.TemplateLiteral;
				return tmpl.expressions.some((expr) =>
					this.isExpressionTainted(expr, recordBoundVars, taintedVars),
				);
			}

			case "SpreadElement": {
				const spread = node as acorn.SpreadElement;
				return this.isExpressionTainted(
					spread.argument,
					recordBoundVars,
					taintedVars,
				);
			}

			default:
				// Literals, ThisExpression, etc. are never tainted
				return false;
		}
	}

	/**
	 * Checks if a MemberExpression accesses a PII field on a record-bound variable.
	 * Examples: r.accountHolder, r["name"], taintedVar.length, taintedVar[0]
	 */
	private isMemberExprTainted(
		member: acorn.MemberExpression,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): boolean {
		const propName = this.getPropertyName(member);

		// Case 1: recordBoundVar.piiField (direct PII access via callback param)
		if (
			member.object.type === "Identifier" &&
			recordBoundVars.has((member.object as acorn.Identifier).name) &&
			propName &&
			this.piiFields.has(propName.toLowerCase())
		) {
			return true;
		}

		// Case 2: env.records[N].piiField or accounts[N].piiField (direct indexed access without callback)
		// AST: MemberExpression { object: MemberExpression { object: env.records, computed: true }, property: piiField }
		if (
			member.object.type === "MemberExpression" &&
			propName &&
			this.piiFields.has(propName.toLowerCase())
		) {
			const parentMember = member.object as acorn.MemberExpression;
			if (parentMember.computed && this.isRecordsSource(parentMember.object)) {
				return true;
			}
		}

		// Case 3: taintedVar.anything (any property access on tainted value)
		// .length on a tainted string leaks PII info, .charCodeAt leaks chars, etc.
		if (this.isExpressionTainted(member.object, recordBoundVars, taintedVars)) {
			return true;
		}

		// Case 4: Computed access on record-bound var with PII field
		// e.g., r["account" + "Holder"]
		if (
			member.computed &&
			member.object.type === "Identifier" &&
			recordBoundVars.has((member.object as acorn.Identifier).name)
		) {
			// Conservative: if computed access on record, check if the property
			// expression evaluates to a PII field (for string literals only)
			if (member.property.type === "Literal") {
				const litVal = (member.property as acorn.Literal).value;
				if (
					typeof litVal === "string" &&
					this.piiFields.has(litVal.toLowerCase())
				) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Checks if a CallExpression produces a tainted result.
	 * Handles: taintedObj.method(), env.records.map(r => r.piiField), etc.
	 */
	private isCallExprTainted(
		call: acorn.CallExpression,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): boolean {
		// Pattern: taintedObj.method() — method on tainted object propagates taint
		if (call.callee.type === "MemberExpression") {
			const callee = call.callee as acorn.MemberExpression;
			const methodName = this.getPropertyName(callee);

			// tainted.charCodeAt() / tainted.split() / etc.
			if (
				methodName &&
				TaintAnalyzer.TAINT_PROPAGATING_METHODS.has(methodName) &&
				this.isExpressionTainted(callee.object, recordBoundVars, taintedVars)
			) {
				return true;
			}

			// env.records.map/filter/reduce(callback) or alias.map/filter/reduce(callback) — check if callback produces taint
			if (this.isRecordsSource(callee.object) && call.arguments[0]) {
				const callback = call.arguments[0];
				if (
					callback.type === "ArrowFunctionExpression" ||
					callback.type === "FunctionExpression"
				) {
					return this.doesCallbackProduceTaint(
						callback as acorn.ArrowFunctionExpression,
						methodName,
						recordBoundVars,
						taintedVars,
					);
				}
			}

			// Tainted array/string method chains: tainted.reduce(...), tainted.map(...)
			// Handles patterns like r.accountHolder.split('').reduce((a,c) => ...)
			if (
				this.isExpressionTainted(callee.object, recordBoundVars, taintedVars)
			) {
				return true;
			}

			// Math.round(taintedArg) / JSON.stringify(taintedArg) — function calls with tainted arguments
			// on safe objects still produce tainted results
			if (
				call.arguments.some((arg) =>
					this.isExpressionTainted(arg, recordBoundVars, taintedVars),
				)
			) {
				return true;
			}
		}

		// Pattern: someArray.push(taintedValue) — marks the receiving array as tainted
		// This covers imperative for-of patterns:
		//   for (const r of env.records) { codes.push(r.name.charCodeAt(0)) }
		if (call.callee.type === "MemberExpression") {
			const callee = call.callee as acorn.MemberExpression;
			const methodName = this.getPropertyName(callee);
			if (
				methodName === "push" &&
				callee.object.type === "Identifier" &&
				call.arguments.some((arg) =>
					this.isExpressionTainted(arg, recordBoundVars, taintedVars),
				)
			) {
				// Mark the array variable as tainted (it now contains PII-derived values)
				taintedVars.add((callee.object as acorn.Identifier).name);
			}
		}

		// Check if any argument is tainted (for functions that might propagate)
		// Conservative: if calling a function WITH tainted args, consider result tainted
		// This catches: someHelper(r.name), parseInt(taintedVar), etc.
		if (call.callee.type === "Identifier") {
			const fnName = (call.callee as acorn.Identifier).name;
			if (taintedVars.has(fnName)) {
				return true;
			}
			// Allow safe math/utility functions that don't propagate PII
			const SAFE_GLOBALS = new Set([
				"Math",
				"Number",
				"parseInt",
				"parseFloat",
				"isNaN",
				"isFinite",
			]);
			if (!SAFE_GLOBALS.has(fnName)) {
				return call.arguments.some((arg) =>
					this.isExpressionTainted(arg, recordBoundVars, taintedVars),
				);
			}
		}

		return false;
	}

	/**
	 * Checks if an array method callback produces tainted output.
	 * e.g., env.records.map(r => r.name.charCodeAt(0)) → tainted result
	 */
	private doesCallbackProduceTaint(
		callback:
			| acorn.ArrowFunctionExpression
			| acorn.FunctionExpression
			| acorn.FunctionDeclaration,
		methodName: string | null,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): boolean {
		// Create a temporary scope with callback params as record-bound
		const scopedRecordVars = new Set(recordBoundVars);
		const scopedTaintedVars = new Set(taintedVars);

		if (callback.params.length > 0) {
			const isReduce =
				methodName !== null && TaintAnalyzer.REDUCE_METHODS.has(methodName);
			const recordParamIndex = isReduce ? 1 : 0;

			if (
				callback.params.length > recordParamIndex &&
				callback.params[recordParamIndex].type === "Identifier"
			) {
				scopedRecordVars.add(
					(callback.params[recordParamIndex] as acorn.Identifier).name,
				);
			}
		}

		// For arrow functions with expression body: (r) => r.name.charCodeAt(0)
		if (
			callback.type === "ArrowFunctionExpression" &&
			callback.body.type !== "BlockStatement"
		) {
			return this.isExpressionTainted(
				callback.body,
				scopedRecordVars,
				scopedTaintedVars,
			);
		}

		// For block bodies, propagate taint within the callback scope first
		this.propagateTaint(
			callback.body as acorn.Node,
			scopedRecordVars,
			scopedTaintedVars,
		);

		// Check return statements or yield expressions within the callback
		let hasTaintedReturnOrYield = false;
		const returnVisitors: SimpleVisitors<void> = {
			ReturnStatement: (node) => {
				if (
					node.argument &&
					this.isExpressionTainted(
						node.argument,
						scopedRecordVars,
						scopedTaintedVars,
					)
				) {
					hasTaintedReturnOrYield = true;
				}
			},
			YieldExpression: (node) => {
				const yieldNode = node as acorn.YieldExpression;
				if (
					yieldNode.argument &&
					this.isExpressionTainted(
						yieldNode.argument,
						scopedRecordVars,
						scopedTaintedVars,
					)
				) {
					hasTaintedReturnOrYield = true;
				}
			},
		};

		simple(callback.body as acorn.Node, returnVisitors);

		return hasTaintedReturnOrYield;
	}

	// ── Utility Methods ───────────────────────────────────────────────

	/** Extracts the property name from a MemberExpression (dot or bracket with string literal) */
	private getPropertyName(member: acorn.MemberExpression): string | null {
		if (!member.computed && member.property.type === "Identifier") {
			return (member.property as acorn.Identifier).name;
		}
		if (member.computed && member.property.type === "Literal") {
			const val = (member.property as acorn.Literal).value;
			if (typeof val === "string") return val;
		}
		return null;
	}

	/** Checks if an expression resolves to `env.records` or `records` */
	private isEnvRecordsAccess(node: acorn.Node): boolean {
		// Direct: env.records
		if (node.type === "MemberExpression") {
			const member = node as acorn.MemberExpression;
			const propName = this.getPropertyName(member);
			if (
				propName === "records" &&
				member.object.type === "Identifier" &&
				(member.object as acorn.Identifier).name === "env"
			) {
				return true;
			}
		}
		// Bare: records (injected as sandbox global)
		if (
			node.type === "Identifier" &&
			(node as acorn.Identifier).name === "records"
		) {
			return true;
		}
		return false;
	}

	/** Generates a human-readable description of the taint source for error messages */
	private describeTaintSource(
		node: acorn.Node,
		recordBoundVars: Set<string>,
		taintedVars: Set<string>,
	): string | undefined {
		if (node.type === "Identifier") {
			const name = (node as acorn.Identifier).name;
			if (taintedVars.has(name)) return `variable '${name}' is PII-derived`;
		}

		if (node.type === "ObjectExpression") {
			const obj = node as acorn.ObjectExpression;
			for (const prop of obj.properties) {
				if (
					prop.type === "Property" &&
					this.isExpressionTainted(prop.value, recordBoundVars, taintedVars)
				) {
					const keyName =
						prop.key.type === "Identifier"
							? (prop.key as acorn.Identifier).name
							: "unknown";
					return `property '${keyName}' contains PII-derived value`;
				}
			}
		}

		if (node.type === "CallExpression") {
			const call = node as acorn.CallExpression;
			if (call.callee.type === "MemberExpression") {
				const methodName = this.getPropertyName(
					call.callee as acorn.MemberExpression,
				);
				if (methodName) return `result of .${methodName}() on PII data`;
			}
		}

		return undefined;
	}
}
