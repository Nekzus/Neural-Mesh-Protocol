import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the shared proto file in the monorepo
const PROTO_PATH = path.resolve(__dirname, "../../../../protocol/proto/nmp_core.proto");

/**
 * NMP Proto Loader
 * Loads the core gRPC definitions for the Neural Mesh Protocol.
 */
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

export const nmpProto = grpc.loadPackageDefinition(packageDefinition) as any;
export const nmpV1 = nmpProto.nmp.v1;
