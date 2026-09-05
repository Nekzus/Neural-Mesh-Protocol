// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LiopServer } from "../server/index.js";
import { WasiSandbox } from "./wasi.js";

describe("Sandbox Security (V8 Fallback)", () => {
	let sandbox: WasiSandbox;

	beforeEach(async () => {
		sandbox = new WasiSandbox();
		await sandbox.init();
	});

	afterEach(async () => {
		await sandbox.teardown();
	});

	describe("SEC-GAP-1: globalThis Mutation & Escape", () => {
		it("should PREVENT globalThis from accepting property assignments", async () => {
			const code = `
                function liop_main() {
                    try {
                        globalThis.__exfil = "stolen";
                        return { success: globalThis.__exfil === "stolen" };
                    } catch(e) {
                        return { error: e.message };
                    }
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			// In a secure frozen environment, assignment throws in strict mode or silently fails
			expect(output.success).not.toBe(true);
		});

		it("should prevent prototype chain traversal via constructor.constructor", async () => {
			const code = `
                function liop_main() {
                    try {
                        const HostProcess = this.constructor.constructor('return process')();
                        return { hasProcess: HostProcess !== undefined };
                    } catch(e) {
                        return { error: e.message };
                    }
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			expect(output.hasProcess).not.toBe(true);
		});

		it("should prevent globalThis.process access", async () => {
			const code = `
                function liop_main() {
                    return { hasProcess: typeof process !== 'undefined' || typeof globalThis.process !== 'undefined' };
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			expect(output.hasProcess).not.toBe(true);
			if (output.error) {
				expect(output.error).toContain("globalThis");
			}
		});
	});

	describe("SEC-GAP-2: eval/Function Exposure", () => {
		it("should PREVENT eval() from being callable", async () => {
			const code = `
                function liop_main() {
                    try {
                        const res = eval("1+1");
                        return { result: res };
                    } catch(e) {
                        return { error: e.message };
                    }
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			expect(output.result).not.toBeDefined();
			expect(output.error).toMatch(/eval is not (a function|defined)/);
		});

		it("should PREVENT new Function() from being callable", async () => {
			const code = `
                function liop_main() {
                    try {
                        const fn = new Function("return 42;");
                        return { result: fn() };
                    } catch(e) {
                        return { error: e.message };
                    }
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			expect(output.result).not.toBeDefined();
			expect(output.error).toMatch(/Function is not (a constructor|defined)/);
		});

		it("should verify bare-return pattern works correctly (regression)", async () => {
			const code = `return { total: env.records.length };`;
			const records = [{ id: 1 }, { id: 2 }];
			const result = await sandbox.execute(code, records);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			expect((result.output as any).total).toBe(2);
		});

		it("should verify liop_main() entry point works correctly (regression)", async () => {
			const code = `
                function liop_main(env) {
                    return { count: env.records.length };
                }
            `;
			const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
			const result = await sandbox.execute(code, records);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			expect((result.output as any).count).toBe(3);
		});
	});

	describe("SEC-GAP-4: SharedArrayBuffer Exposure", () => {
		it("should completely BLOCK SharedArrayBuffer instantiation (Score 100/100 Hardening)", async () => {
			const code = `
                function liop_main() {
                    try {
                        const sab = new SharedArrayBuffer(1024);
                        return { error: "Should not be able to create SAB" };
                    } catch(e) {
                        return { error: e.message };
                    }
                }
            `;
			const result = await sandbox.execute(code);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic execution output
			const output = result.output as any;
			// The buffer should not exist at all in the global scope
			expect(output.error).toMatch(
				/SharedArrayBuffer is not (defined|a constructor)/,
			);
		});
	});
});

describe("SEC-GAP-3: Aggregation Policy False Positives", () => {
	let server: LiopServer;

	beforeEach(() => {
		server = new LiopServer({ name: "test", version: "1" });
	});

	it("should allow small aggregation arrays (top-3 results) and primitive arrays", async () => {
		// Enforce policy but with new AggregationPolicy defaults
		server.tool(
			"query",
			"Query data",
			{ payload: z.string() },
			async () => ({ content: [] }),
			{ enforceAggregationFirst: true },
		);

		const payloadTop3 = `@LIOP{wasi_v1,Test}
return [
    { month: "Jan", total: 100 },
    { month: "Feb", total: 200 },
    { month: "Mar", total: 300 }
];
@END`;

		const res1 = await server.callTool({
			name: "query",
			arguments: { payload: payloadTop3 },
		});
		expect(res1.isError).toBeFalsy();

		const payloadPrimitives = `@LIOP{wasi_v1,Test}
return [1, 2, 3, 4, 5];
@END`;

		const res2 = await server.callTool({
			name: "query",
			arguments: { payload: payloadPrimitives },
		});
		expect(res2.isError).toBeFalsy();
	});

	it("should block large row-level exports (>10 records)", async () => {
		server.tool(
			"query_large",
			"Query data",
			{ payload: z.string() },
			async () => ({ content: [] }),
			{ enforceAggregationFirst: { maxOutputRows: 10 } },
		);

		const payloadLarge = `@LIOP{wasi_v1,Test}
const res = [];
for (let i = 0; i < 15; i++) {
    res.push({ id: i, value: "data" });
}
return res;
@END`;

		const res = await server.callTool({
			name: "query_large",
			arguments: { payload: payloadLarge },
		});
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Aggregation-First Policy Violation");
	});
});
