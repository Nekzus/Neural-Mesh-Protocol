// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import * as fs from "node:fs";
import { log } from "../utils/logger.js";

// Selection logic: support both flat dist/ and original src/ structure
const PROD_PATHS = [
	path.resolve(__dirname, "./protocol/liop_core.proto"), // Flat dist/ (tsup)
	path.resolve(__dirname, "../protocol/liop_core.proto"), // dist/rpc/ (tsc)
];

const DEV_PROTO_PATH = path.resolve(
	__dirname,
	"../../../../protocol/proto/liop_core.proto",
);

// Selection logic
const PROTO_PATH = PROD_PATHS.find((p) => fs.existsSync(p)) || DEV_PROTO_PATH;

if (!fs.existsSync(PROTO_PATH)) {
	log.error(`[LIOP-Proto] CRITICAL: Proto file not found at ${PROTO_PATH}`);
}

/**
 * LIOP Proto Loader
 * Loads the core gRPC definitions for the Logic-Injection-on-Origin Protocol.
 */
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true,
});

// biome-ignore lint/suspicious/noExplicitAny: gRPC dynamic loading requires any for the service definition map
export const liopProto = grpc.loadPackageDefinition(packageDefinition) as any;
export const liopV1 = liopProto.liop.v1;
