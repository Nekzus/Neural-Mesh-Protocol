import { expect } from "vitest";

const DEFAULT_NEXUS_URL = process.env.NEXUS_URL || "http://127.0.0.1:15000";
const DEFAULT_TIMEOUT_MS = 60_000;

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number;
	// biome-ignore lint/suspicious/noExplicitAny: generic JSON-RPC result
	result?: any;
	error?: { code: number; message: string };
};

let cachedAuthToken: string | null = null;

export async function getAuthToken(baseUrl = DEFAULT_NEXUS_URL, forceRefresh = false): Promise<string | null> {
	if (cachedAuthToken && !forceRefresh) return cachedAuthToken;
	try {
		const res = await fetch(`${baseUrl}/oidc/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: process.env.LIOP_CLIENT_ID || "liop-mesh-agent",
				client_secret: process.env.LIOP_CLIENT_SECRET || "dev-secret-change-me",
				resource: "urn:liop:mesh:api",
				scope: "liop:tools:call liop:tools:list liop:resources:read liop:schema:read liop:mesh:query",
			}).toString(),
		});
		if (res.ok) {
			const data = (await res.json()) as { access_token?: string };
			if (data.access_token) {
				cachedAuthToken = data.access_token;
				return cachedAuthToken;
			}
		}
	} catch {
		// Non-auth fallback
	}
	return null;
}

export async function mcpCall(
	method: string,
	params: Record<string, unknown>,
	id = Date.now(),
	baseUrl = DEFAULT_NEXUS_URL,
): Promise<JsonRpcResponse> {
	let token = await getAuthToken(baseUrl);
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	let res = await fetchWithRetry(`${baseUrl}/mcp`, {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});

	if (res.status === 401) {
		// Token expired or invalid — force refresh and retry once
		token = await getAuthToken(baseUrl, true);
		if (token) {
			headers.Authorization = `Bearer ${token}`;
			res = await fetchWithRetry(`${baseUrl}/mcp`, {
				method: "POST",
				headers,
				body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
			});
		}
	}

	expect(res.ok).toBe(true);
	return (await res.json()) as JsonRpcResponse;
}

export async function listTools(baseUrl = DEFAULT_NEXUS_URL): Promise<Array<{ name: string; description?: string }>> {
	const response = await mcpCall("tools/list", {}, 101, baseUrl);
	expect(response.error).toBeUndefined();
	expect(response.result).toBeDefined();
	return response.result.tools as Array<{ name: string; description?: string }>;
}

export async function findToolByBaseName(baseName: string, baseUrl = DEFAULT_NEXUS_URL, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastTools: Array<{ name: string }> = [];

	while (Date.now() < deadline) {
		try {
			lastTools = await listTools(baseUrl);
			const exact = lastTools.find((t) => t.name === baseName);
			if (exact) return exact.name;

			const suffixed = lastTools.find((t) => t.name.startsWith(`${baseName}_`));
			if (suffixed) return suffixed.name;
		} catch {
			// retry
		}
		await sleep(1000);
	}

	const names = lastTools.map((t) => t.name).sort().join(", ");
	throw new Error(`Tool not found in tools/list after ${timeoutMs}ms: ${baseName}. Known tools: [${names}]`);
}

export function liopEnvelope(logic: string, moduleName = "AuditLogic"): string {
	return [
		`@LIOP{wasi_v1,${moduleName}}`,
		logic.trim(),
		"@END",
	].join("\n");
}

export function extractText(result: unknown): string {
	// biome-ignore lint/suspicious/noExplicitAny: generic extraction
	const content = (result as any)?.content;
	if (!Array.isArray(content) || content.length === 0) return "";
	const text = content[0]?.text;
	return typeof text === "string" ? text : "";
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, init);
			if (res.ok) return res;
			lastError = new Error(`HTTP ${res.status} for ${url}`);
		} catch (error) {
			lastError = error;
		}
		await sleep(500);
	}
	throw lastError instanceof Error ? lastError : new Error(`fetchWithRetry timeout for ${url}`);
}

export async function waitForHealthy(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
	const res = await fetchWithRetry(`${baseUrl}/health`, {
		headers: { Accept: "application/json" },
	}, timeoutMs);
	const body = (await res.json()) as Record<string, unknown>;
	expect(body.status).toBe("healthy");
	return body;
}

export async function callTool(
	toolName: string,
	payload: string,
	baseUrl = DEFAULT_NEXUS_URL,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	// biome-ignore lint/suspicious/noExplicitAny: result return
): Promise<any> {
	const deadline = Date.now() + timeoutMs;
	// biome-ignore lint/suspicious/noExplicitAny: transient tracking
	let lastResult: any = undefined;

	while (Date.now() < deadline) {
		const response = await mcpCall(
			"tools/call",
			{
				name: toolName,
				arguments: { payload },
			},
			Date.now() % 100000,
			baseUrl,
		);

		if (response.error) {
			const msg = `tools/call failed [${response.error.code}]: ${response.error.message}`;
			if (isTransient(msg)) {
				lastResult = { isError: true, content: [{ type: "text", text: msg }] };
				await sleep(1000);
				continue;
			}
			throw new Error(msg);
		}

		lastResult = response.result;
		const text = extractText(lastResult);
		if (isTransient(text)) {
			await sleep(1500);
			continue;
		}

		return lastResult;
	}

	return lastResult;
}

function isTransient(message: string): boolean {
	return /PQC Handshake Failed|UNAVAILABLE|ECONNREFUSED|No connection established|timeout|LIOP_RATE_LIMITED/i.test(
		message,
	);
}
