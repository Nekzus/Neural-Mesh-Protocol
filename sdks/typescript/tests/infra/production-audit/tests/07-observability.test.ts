import { describe, expect, it } from "vitest";

const NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";

describe("Production Audit Suite 07 — SOC 2 Observability, Prometheus Metrics & Probes", () => {
	it("should expose Prometheus /metrics endpoint on Nexus Gateway", async () => {
		const res = await fetch(`${NEXUS_URL}/metrics`);
		expect(res.ok).toBe(true);
		const text = await res.text();

		// Check for presence of Prometheus metric markers
		expect(text).toContain("# HELP");
		expect(text).toContain("# TYPE");
		console.log(`[Prometheus Metrics OK] Length: ${text.length} bytes`);
	});

	it("should respond to standard healthcheck on /health", async () => {
		const res = await fetch(`${NEXUS_URL}/health`, {
			headers: { Accept: "application/json" },
		});
		expect(res.ok).toBe(true);
		const json = (await res.json()) as { status: string };
		expect(json.status).toBe("healthy");
	});

	it("should support gRPC-Web HTTP/1.1 framing fallback for restricted environments", async () => {
		// Test ping frame to gRPC-Web endpoint
		const frame = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x04, 0x74, 0x65, 0x73, 0x74]); // 4-byte payload
		const res = await fetch(`${NEXUS_URL}/liop.LiopService/Intent`, {
			method: "POST",
			headers: {
				"content-type": "application/grpc-web+proto",
			},
			body: frame,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/grpc-web");
		console.log("[gRPC-Web Framing Fallback OK] Status 200 returned with correct content-type");
	});
});
