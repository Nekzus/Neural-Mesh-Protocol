// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP TLS Configuration
 *
 * Provides conditional TLS credential factories for gRPC connections.
 * When TLS options are provided, connections are secured with mutual TLS.
 * Otherwise, falls back to insecure credentials (alpha/development mode).
 *
 * Production Hardening (Phase 128):
 * - When NODE_ENV=production and TLS is configured but certificate loading
 *   fails, the system throws a fatal error instead of silently degrading
 *   to insecure credentials. This prevents MITM/eavesdropping attacks
 *   caused by misconfigured certificate paths going unnoticed.
 * - Reference: gRPC-node official docs — "Using insecure credentials in
 *   production poses significant security risks including eavesdropping,
 *   MITM attacks, and lack of authentication."
 */

import * as fs from "node:fs";
import * as grpc from "@grpc/grpc-js";
import type { CertManager } from "../security/cert-manager.js";
import { log } from "../utils/logger.js";

export interface LiopTlsOptions {
	/** Path to the root CA certificate (PEM format) */
	rootCert?: string;
	/** Path to the server/client certificate (PEM format) */
	certChain?: string;
	/** Path to the private key (PEM format) */
	privateKey?: string;
	/** Require mutual TLS (mTLS): verify client certificate against root CA */
	mutualTls?: boolean;
	/** Optional CertManager instance for automated certificate management and hot reloading */
	certManager?: CertManager;
}

const isTlsEnforced = () =>
	process.env.NODE_ENV === "production" ||
	process.env.LIOP_ENFORCE_TLS === "true";

/**
 * Creates gRPC server credentials from TLS options.
 * In production or when LIOP_ENFORCE_TLS=true, refuses to fall back to insecure.
 * When mutualTls=true, enforces client certificate authentication against root CA.
 */
export function createServerCredentials(
	tls?: LiopTlsOptions,
): grpc.ServerCredentials {
	// Mutual TLS requires a root CA certificate to authenticate clients
	if (tls?.mutualTls && !tls.rootCert && !tls.certManager?.getRootCert()) {
		throw new Error(
			"[LIOP-TLS] FATAL: Mutual TLS (mTLS) enabled but no root CA certificate (rootCert) provided to verify client certificates.",
		);
	}

	// If CertManager is provided, use its in-memory cached buffers
	if (tls?.certManager) {
		try {
			const certChain = tls.certManager.getCertChain();
			const privateKey = tls.certManager.getPrivateKey();
			const rootCert = tls.certManager.getRootCert();

			if (tls.mutualTls && !rootCert) {
				throw new Error(
					"[LIOP-TLS] FATAL: Mutual TLS (mTLS) enabled but CertManager has no root CA certificate loaded.",
				);
			}

			return grpc.ServerCredentials.createSsl(
				rootCert,
				[{ cert_chain: certChain, private_key: privateKey }],
				Boolean(tls.mutualTls),
			);
		} catch (error) {
			if (isTlsEnforced()) {
				throw new Error(
					`[LIOP-TLS] FATAL: CertManager server credential creation failed in enforced mode: ${error}`,
				);
			}
			log.warn(
				`[LIOP-TLS] CertManager failed, falling back to insecure: ${error}`,
			);
			return grpc.ServerCredentials.createInsecure();
		}
	}

	if (!tls?.certChain || !tls?.privateKey) {
		if (isTlsEnforced()) {
			throw new Error(
				"[LIOP-TLS] FATAL: TLS certificates required in production or when LIOP_ENFORCE_TLS=true.",
			);
		}
		log.warn(
			"[LIOP-TLS] No TLS certificates configured — using insecure server credentials",
		);
		return grpc.ServerCredentials.createInsecure();
	}

	try {
		const rootCert = tls.rootCert ? fs.readFileSync(tls.rootCert) : null;
		const certChain = fs.readFileSync(tls.certChain);
		const privateKey = fs.readFileSync(tls.privateKey);

		if (tls.mutualTls && !rootCert) {
			throw new Error(
				"[LIOP-TLS] FATAL: Mutual TLS (mTLS) enabled but no root CA certificate (rootCert) provided to verify client certificates.",
			);
		}

		return grpc.ServerCredentials.createSsl(
			rootCert,
			[{ cert_chain: certChain, private_key: privateKey }],
			Boolean(tls.mutualTls),
		);
	} catch (error) {
		if (isTlsEnforced()) {
			throw new Error(
				`[LIOP-TLS] FATAL: Server certificate loading failed in production or enforced mode. ` +
					`Refusing insecure fallback to prevent MITM/eavesdropping: ${error}`,
			);
		}
		log.warn(
			`[LIOP-TLS] Server certificate loading failed, falling back to insecure (dev mode): ${error}`,
		);
		return grpc.ServerCredentials.createInsecure();
	}
}

/**
 * Creates gRPC channel credentials from TLS options.
 * In production or when LIOP_ENFORCE_TLS=true, refuses to fall back to insecure.
 */
export function createChannelCredentials(
	tls?: LiopTlsOptions,
): grpc.ChannelCredentials {
	// If CertManager is provided, use its in-memory cached credentials
	if (tls?.certManager) {
		try {
			const rootCert = tls.certManager.getRootCert();
			if (!rootCert) {
				throw new Error(
					"[LIOP-TLS] FATAL: Channel TLS requires a root CA certificate in CertManager.",
				);
			}
			const certChain = tls.certManager.getCertChain();
			const privateKey = tls.certManager.getPrivateKey();
			return grpc.credentials.createSsl(rootCert, privateKey, certChain);
		} catch (error) {
			if (isTlsEnforced()) {
				throw new Error(
					`[LIOP-TLS] FATAL: Channel certificate loading failed in enforced mode: ${error}`,
				);
			}
			log.warn(
				`[LIOP-TLS] Channel CertManager failed, falling back to insecure: ${error}`,
			);
			return grpc.credentials.createInsecure();
		}
	}

	if (!tls?.rootCert) {
		if (isTlsEnforced()) {
			throw new Error(
				"[LIOP-TLS] FATAL: TLS root certificate required in production or when LIOP_ENFORCE_TLS=true.",
			);
		}
		log.warn(
			"[LIOP-TLS] No TLS root certificate configured — using insecure channel credentials",
		);
		return grpc.credentials.createInsecure();
	}

	try {
		const rootCert = fs.readFileSync(tls.rootCert);
		const certChain = tls.certChain
			? fs.readFileSync(tls.certChain)
			: undefined;
		const privateKey = tls.privateKey
			? fs.readFileSync(tls.privateKey)
			: undefined;

		return grpc.credentials.createSsl(rootCert, privateKey, certChain);
	} catch (error) {
		if (isTlsEnforced()) {
			throw new Error(
				`[LIOP-TLS] FATAL: Channel certificate loading failed in production or enforced mode. ` +
					`Refusing insecure fallback to prevent MITM/eavesdropping: ${error}`,
			);
		}
		log.warn(
			`[LIOP-TLS] Channel certificate loading failed, falling back to insecure (dev mode): ${error}`,
		);
		return grpc.credentials.createInsecure();
	}
}
