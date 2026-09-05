// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Production-Grade gRPC Channel Options
 *
 * Enforces bidirectional symmetry between LiopRpcServer, LiopRpcClient,
 * and gateway proxy channels per NIST SP 800-207 continuous verification.
 * Prevents silent disconnections behind corporate stateful firewalls and NAT gateways.
 */
export const GRPC_CHANNEL_OPTIONS: Readonly<Record<string, string | number>> = {
	"grpc.keepalive_time_ms": 30_000,
	"grpc.keepalive_timeout_ms": 10_000,
	"grpc.keepalive_permit_without_calls": 1,
	"grpc.max_send_message_length": -1,
	"grpc.max_receive_message_length": -1,
	"grpc.enable_retries": 1,
};
