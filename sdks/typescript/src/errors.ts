// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

export enum ErrorCode {
	CapabilityViolation = "CapabilityViolation",
	SandboxEscape = "SandboxEscape",
	PiiLeak = "PiiLeak",
	InvalidIntent = "InvalidIntent",
	Throttled = "Throttled",
	ZkVerificationFailed = "ZkVerificationFailed",
	MeshUnavailable = "MeshUnavailable",
	ConnectionFailed = "ConnectionFailed",
}

export class LiopError extends Error {
	public readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string) {
		super(message);
		this.name = "LiopError";
		this.code = code;
	}
}
