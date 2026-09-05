// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP Certificate Manager (CertManager)
 * Provides automated certificate monitoring, X.509 validity inspection,
 * and hot-reloading for mutual TLS (mTLS) without node restarts.
 *
 * Compliance:
 * - NIST SP 800-52 Rev. 2: Guidelines for the Selection and Use of TLS
 * - Zero-Trust Architecture (NIST SP 800-207): Continuous cryptographic verification
 */

import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { log } from "../utils/logger.js";

export interface CertManagerOptions {
	/** Path to the root CA certificate (PEM format) */
	rootCertPath?: string;
	/** Path to the server/client certificate chain (PEM format) */
	certChainPath: string;
	/** Path to the private key (PEM format) */
	privateKeyPath: string;
	/** Expiration warning threshold in days (default: 30) */
	warningDays?: number;
	/** Enable file watching for automatic hot-reloading (default: true) */
	watchFiles?: boolean;
	/** Debounce delay in ms for hot reloading (default: 150) */
	debounceMs?: number;
}

export interface CertInfo {
	subject: string;
	issuer: string;
	validFrom: string;
	validTo: string;
	fingerprint256: string;
	daysRemaining: number;
	isExpired: boolean;
	isExpiringSoon: boolean;
}

export class CertManager extends EventEmitter {
	private rootCertBuffer: Buffer | null = null;
	private certChainBuffer: Buffer | null = null;
	private privateKeyBuffer: Buffer | null = null;
	private watchers: fs.FSWatcher[] = [];
	private reloadDebounceTimer: NodeJS.Timeout | null = null;
	private readonly warningDays: number;
	private readonly debounceMs: number;

	constructor(private readonly options: CertManagerOptions) {
		super();
		this.warningDays = options.warningDays ?? 30;
		this.debounceMs = options.debounceMs ?? 150;
		this.loadCertificates();

		if (options.watchFiles !== false) {
			this.setupWatchers();
		}
	}

	/**
	 * Synchronously loads or reloads certificates from filesystem into memory.
	 */
	public loadCertificates(): void {
		try {
			if (
				this.options.rootCertPath &&
				fs.existsSync(this.options.rootCertPath)
			) {
				this.rootCertBuffer = fs.readFileSync(this.options.rootCertPath);
			}

			if (!fs.existsSync(this.options.certChainPath)) {
				throw new Error(
					`Certificate chain file not found: ${this.options.certChainPath}`,
				);
			}
			if (!fs.existsSync(this.options.privateKeyPath)) {
				throw new Error(
					`Private key file not found: ${this.options.privateKeyPath}`,
				);
			}

			this.certChainBuffer = fs.readFileSync(this.options.certChainPath);
			this.privateKeyBuffer = fs.readFileSync(this.options.privateKeyPath);

			log.info("[CertManager] Certificates loaded successfully.");
		} catch (error) {
			log.error(`[CertManager] Failed to load certificates: ${error}`);
			throw error;
		}
	}

	/**
	 * Inspects the loaded server/client certificate chain using Node.js native X509Certificate.
	 */
	public inspectCertificate(): CertInfo {
		if (!this.certChainBuffer) {
			throw new Error("[CertManager] No certificate loaded to inspect.");
		}

		const x509 = new crypto.X509Certificate(this.certChainBuffer);
		const validToDate = new Date(x509.validTo);
		const now = new Date();
		const msRemaining = validToDate.getTime() - now.getTime();
		const daysRemaining = Math.max(
			0,
			Math.floor(msRemaining / (1000 * 60 * 60 * 24)),
		);
		const isExpired = msRemaining <= 0;
		const isExpiringSoon = daysRemaining <= this.warningDays;

		return {
			subject: x509.subject,
			issuer: x509.issuer,
			validFrom: x509.validFrom,
			validTo: x509.validTo,
			fingerprint256: x509.fingerprint256,
			daysRemaining,
			isExpired,
			isExpiringSoon,
		};
	}

	/**
	 * Sets up non-blocking filesystem watchers to detect certificate renewals
	 * and trigger hot-reloading without process restarts.
	 */
	private setupWatchers(): void {
		const filesToWatch = [
			this.options.certChainPath,
			this.options.privateKeyPath,
			this.options.rootCertPath,
		].filter((p): p is string => Boolean(p && fs.existsSync(p)));

		for (const filePath of filesToWatch) {
			try {
				const watcher = fs.watch(filePath, () => {
					this.scheduleReload();
				});
				this.watchers.push(watcher);
			} catch (err) {
				log.warn(
					`[CertManager] Could not watch ${filePath} for hot reloading: ${err}`,
				);
			}
		}
	}

	/**
	 * Debounces reload events to ensure files have finished writing.
	 */
	private scheduleReload(): void {
		if (this.reloadDebounceTimer) {
			clearTimeout(this.reloadDebounceTimer);
		}

		this.reloadDebounceTimer = setTimeout(() => {
			try {
				this.loadCertificates();
				const certInfo = this.inspectCertificate();
				log.info(
					`[CertManager] Hot reload complete. Certificate expires in ${certInfo.daysRemaining} days.`,
				);
				this.emit("reload", certInfo);
			} catch (error) {
				log.error(`[CertManager] Hot reload failed: ${error}`);
				this.emit("error", error);
			}
		}, this.debounceMs);
	}

	/**
	 * Manually triggers a reload of certificates and emits the 'reload' event.
	 */
	public reload(): CertInfo {
		this.loadCertificates();
		const certInfo = this.inspectCertificate();
		log.info(
			`[CertManager] Hot reload complete. Certificate expires in ${certInfo.daysRemaining} days.`,
		);
		this.emit("reload", certInfo);
		return certInfo;
	}

	public getRootCert(): Buffer | null {
		return this.rootCertBuffer;
	}

	public getCertChain(): Buffer {
		if (!this.certChainBuffer) {
			throw new Error("[CertManager] Certificate chain not loaded.");
		}
		return this.certChainBuffer;
	}

	public getPrivateKey(): Buffer {
		if (!this.privateKeyBuffer) {
			throw new Error("[CertManager] Private key not loaded.");
		}
		return this.privateKeyBuffer;
	}

	/**
	 * Stops all active file watchers and releases resources.
	 */
	public dispose(): void {
		if (this.reloadDebounceTimer) {
			clearTimeout(this.reloadDebounceTimer);
			this.reloadDebounceTimer = null;
		}
		for (const watcher of this.watchers) {
			try {
				watcher.close();
			} catch {
				// Ignore watcher close errors
			}
		}
		this.watchers = [];
		this.removeAllListeners();
	}
}
