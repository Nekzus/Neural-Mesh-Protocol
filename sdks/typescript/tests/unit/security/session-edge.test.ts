import { describe, expect, it } from "vitest";
import processLogicExecution from "../../../src/workers/logic-execution.js";

describe("Session Key Lifecycle Boundary & Edge Hardening (Phase Beta-3 / NIST SP 800-53)", () => {
	const createPayload = (timestamp: number) => ({
		ciphertext: new Uint8Array(1088),
		secretKeyObj: new Uint8Array(2400),
		wasmBinary: Buffer.from("return { ok: true };"),
		inputs: {},
		sessionTimestamp: timestamp,
		isEncrypted: false,
	});

	it("should allow execution at TTL boundary margin (1s before 3600s expiry)", async () => {
		const boundaryTimestamp = Date.now() - 3599 * 1000;
		const payload = createPayload(boundaryTimestamp);

		const result = await processLogicExecution(payload);
		expect(result).toBeDefined();
		expect(result.output).toEqual({ ok: true });
	});

	it("should strictly reject execution when age exceeds 3600s TTL by 1 second", async () => {
		const expiredTimestamp = Date.now() - 3601 * 1000;
		const payload = createPayload(expiredTimestamp);

		await expect(processLogicExecution(payload)).rejects.toThrow(
			/\[LIOP-PQC\] Session secret expired: Age \(\d+s\) exceeds 3600s TTL limit/,
		);
	});

	it("should reject future timestamps that exceed the 60s clock skew allowance", async () => {
		// Exactly 65s in the future (exceeds 60_000ms grace window)
		const futureSkewTimestamp = Date.now() + 65 * 1000;
		const payload = createPayload(futureSkewTimestamp);

		await expect(processLogicExecution(payload)).rejects.toThrow(
			/\[LIOP-PQC\] Session secret invalid: Timestamp is in the future/,
		);
	});

	it("should tolerate acceptable clock skew within the 60s grace window", async () => {
		// 30s in the future (within 60_000ms grace window)
		const acceptableSkewTimestamp = Date.now() + 30 * 1000;
		const payload = createPayload(acceptableSkewTimestamp);

		const result = await processLogicExecution(payload);
		expect(result).toBeDefined();
		expect(result.output).toEqual({ ok: true });
	});

	it("should handle parallel executions near expiry without race conditions or leaks", async () => {
		const nearExpiryTimestamp = Date.now() - 3598 * 1000; // 2s before expiry

		const tasks = [1, 2, 3].map(async () => {
			const payload = createPayload(nearExpiryTimestamp);
			return await processLogicExecution(payload);
		});

		const results = await Promise.all(tasks);
		expect(results).toHaveLength(3);
		for (const res of results) {
			expect(res.output).toEqual({ ok: true });
			expect(res.zk_receipt).toBeDefined();
		}
	});
});
