// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP gRPC-Web Protocol Adapter (HTTP/1.1 Fallback)
 *
 * Implements standard gRPC-Web framing per the official gRPC-Web specification:
 * https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md
 *
 * Allows web browsers, corporate Layer 7 HTTP/1.1 proxies, and enterprise WAFs
 * to invoke LIOP nodes over HTTP/1.1 without requiring HTTP/2 streaming or h2c.
 *
 * Frame Format:
 * - 1 byte: Frame Flag (0x00 = Data Frame, 0x80 = Trailers Frame)
 * - 4 bytes: 32-bit Big-Endian Unsigned Integer (payload length in bytes)
 * - N bytes: Message or Trailer payload
 */

import type * as http from "node:http";
import { log } from "../utils/logger.js";

export const GRPC_WEB_CONSTANTS = {
	FLAG_DATA: 0x00,
	FLAG_TRAILERS: 0x80,
	HEADER_LENGTH: 5,
	CONTENT_TYPE_PREFIX: "application/grpc-web",
	STATUS_OK: 0,
	STATUS_CANCELLED: 1,
	STATUS_UNKNOWN: 2,
	STATUS_INVALID_ARGUMENT: 3,
	STATUS_DEADLINE_EXCEEDED: 4,
	STATUS_NOT_FOUND: 5,
	STATUS_PERMISSION_DENIED: 7,
	STATUS_UNAUTHENTICATED: 16,
	STATUS_INTERNAL: 13,
} as const;

export interface GrpcWebFrame {
	isTrailer: boolean;
	payload: Buffer;
}

/**
 * Checks if an incoming HTTP request is a gRPC-Web request.
 */
export function isGrpcWebRequest(contentType?: string): boolean {
	if (!contentType) return false;
	const lower = contentType.toLowerCase();
	return (
		lower.startsWith("application/grpc-web") ||
		lower.startsWith("application/grpc-web+proto") ||
		lower.startsWith("application/grpc-web+json")
	);
}

/**
 * Encodes a binary payload into a standard 5-byte framed gRPC-Web Data Frame.
 */
export function encodeDataFrame(payload: Buffer | Uint8Array): Buffer {
	const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
	const header = Buffer.alloc(GRPC_WEB_CONSTANTS.HEADER_LENGTH);
	header.writeUInt8(GRPC_WEB_CONSTANTS.FLAG_DATA, 0);
	header.writeUInt32BE(buf.length, 1);
	return Buffer.concat([header, buf]);
}

/**
 * Encodes gRPC status and optional message into a 5-byte framed gRPC-Web Trailer Frame.
 */
export function encodeTrailerFrame(
	status: number = GRPC_WEB_CONSTANTS.STATUS_OK,
	message: string = "",
	customTrailers: Record<string, string> = {},
): Buffer {
	const lines = [
		`grpc-status:${status}`,
		`grpc-message:${encodeURIComponent(message)}`,
	];

	for (const [key, value] of Object.entries(customTrailers)) {
		lines.push(`${key}:${value}`);
	}

	const trailerText = `${lines.join("\r\n")}\r\n`;
	const trailerBuf = Buffer.from(trailerText, "utf-8");

	const header = Buffer.alloc(GRPC_WEB_CONSTANTS.HEADER_LENGTH);
	header.writeUInt8(GRPC_WEB_CONSTANTS.FLAG_TRAILERS, 0);
	header.writeUInt32BE(trailerBuf.length, 1);

	return Buffer.concat([header, trailerBuf]);
}

/**
 * Parses raw gRPC-Web byte streams into an array of frames.
 */
export function decodeFrames(buffer: Buffer): GrpcWebFrame[] {
	const frames: GrpcWebFrame[] = [];
	let offset = 0;

	while (offset + GRPC_WEB_CONSTANTS.HEADER_LENGTH <= buffer.length) {
		const flag = buffer.readUInt8(offset);
		const length = buffer.readUInt32BE(offset + 1);
		const payloadStart = offset + GRPC_WEB_CONSTANTS.HEADER_LENGTH;
		const payloadEnd = payloadStart + length;

		if (payloadEnd > buffer.length) {
			break; // Incomplete frame
		}

		const payload = buffer.subarray(payloadStart, payloadEnd);
		frames.push({
			isTrailer:
				(flag & GRPC_WEB_CONSTANTS.FLAG_TRAILERS) ===
				GRPC_WEB_CONSTANTS.FLAG_TRAILERS,
			payload: Buffer.from(payload),
		});

		offset = payloadEnd;
	}

	return frames;
}

/**
 * Dispatches an HTTP/1.1 gRPC-Web request to an underlying protocol handler
 * and serializes data and trailer frames back to the client.
 */
export async function dispatchGrpcWebRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	handler: (
		path: string,
		payload: Buffer,
	) => Promise<{ status: number; message?: string; data?: Buffer }>,
): Promise<void> {
	const chunks: Buffer[] = [];

	req.on("data", (chunk: Buffer) => {
		chunks.push(chunk);
	});

	req.on("end", async () => {
		try {
			const fullBody = Buffer.concat(chunks);
			const frames = decodeFrames(fullBody);
			const dataPayload =
				frames.find((f) => !f.isTrailer)?.payload ?? Buffer.alloc(0);
			const requestPath = req.url || "/";

			log.info(
				`[gRPC-Web] Handling request for ${requestPath} (${dataPayload.length} bytes)`,
			);

			const result = await handler(requestPath, dataPayload);

			res.statusCode = 200;
			res.setHeader("content-type", "application/grpc-web+proto");
			res.setHeader("access-control-allow-origin", "*");
			res.setHeader(
				"access-control-expose-headers",
				"grpc-status, grpc-message, content-type",
			);

			// Write Data Frame (if response payload exists)
			if (result.data && result.data.length > 0) {
				res.write(encodeDataFrame(result.data));
			}

			// Write Trailer Frame (status and message)
			res.write(encodeTrailerFrame(result.status, result.message || ""));
			res.end();
		} catch (error) {
			log.error(`[gRPC-Web] Dispatch error: ${error}`);
			res.statusCode = 200;
			res.setHeader("content-type", "application/grpc-web+proto");
			res.write(
				encodeTrailerFrame(
					GRPC_WEB_CONSTANTS.STATUS_INTERNAL,
					(error as Error).message || "Internal server error",
				),
			);
			res.end();
		}
	});
}
