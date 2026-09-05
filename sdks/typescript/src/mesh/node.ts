// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { autoNAT } from "@libp2p/autonat";
import { bootstrap } from "@libp2p/bootstrap";
import {
	circuitRelayServer,
	circuitRelayTransport,
} from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { identify } from "@libp2p/identify";
import { kadDHT } from "@libp2p/kad-dht";
import { mdns } from "@libp2p/mdns";
import { ping } from "@libp2p/ping";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { multiaddr } from "@multiformats/multiaddr";
import { pipe } from "it-pipe";
import type { Libp2p } from "libp2p";
import { createLibp2p } from "libp2p";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { log } from "../utils/logger.js";
// import { pEvent } from "p-event"; // Disabled to avoid ESM conflicts in tests

/**
 * Manifest describing a node's capabilities in the LIOP Mesh.
 * Exchanged via the /liop/manifest/1.0.0 protocol stream.
 */
export interface LiopManifest {
	peerId: string;
	grpcPort: number;
	tools: Array<{
		name: string;
		description?: string;
		inputSchema?: Record<string, unknown>;
	}>;
	resources: Array<{
		name: string;
		uri: string;
		description?: string;
		mimeType?: string;
		text?: string;
	}>;
	serverInfo: { name: string; version: string };
	taxonomy?: {
		domain: string;
		clearanceTier: number;
		executionTypes: string[];
	};
	authRequired?: boolean;
	/** Canonical slug for deterministic token resolution. Agents resolve LIOP_TOKEN_<tokenSlug>. Must match /^[A-Z][A-Z0-9_]*$/. */
	tokenSlug?: string;
	/** ML-DSA-65 (FIPS 204) Post-Quantum Digital Signature for Manifest Attestation (Base64) */
	pqcSignature?: string;
	/** ML-DSA-65 (FIPS 204) Post-Quantum Public Key (Base64) */
	pqcPublicKey?: string;
}

export interface MeshNodeConfig {
	listenAddresses?: string[];
	bootstrapNodes?: string[];
	identityPath?: string;
	enableWAN?: boolean;
	dhtStoragePath?: string;
	/** Optional function to translate multiaddrs (e.g. for Docker NAT traversal). Return null to drop an address. */
	addressMapper?: (addr: string) => string | null;
	/** Enable AutoNAT reachability detection (default: true) */
	enableAutoNAT?: boolean;
	/** Enable Circuit Relay v2 transport & server for NAT traversal (default: true) */
	enableRelay?: boolean;
	/** Enable DCUtR decentralized hole punching (default: true) */
	enableDcutr?: boolean;
	/** Enable mDNS peer discovery for local networks (default: false in WAN, true in LAN) */
	enableMdns?: boolean;
	/**
	 * Pre-Shared Key for libp2p Private Network isolation (Tier 1 Enclave Hardening).
	 * When provided, the node will reject ALL connections from peers that do not
	 * possess the identical 95-byte PSK at the transport framing layer,
	 * BEFORE the Noise XX handshake is attempted.
	 * @see https://github.com/libp2p/specs/blob/master/pnet/Private-Networks-PSK-V1.md
	 */
	swarmKey?: Uint8Array;
}

const DEFAULT_BOOTSTRAP_NODES = [
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDuVkcruPhcoXdia1vAHm1qrCEYWvmqVkMBjeEbFR",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjWZcYW7dwt",
];

const LIOP_MANIFEST_PROTOCOL = "/liop/manifest/1.0.0";
const LIOP_MANIFEST_CAPABILITY = "liop:manifest";

/**
 * P2P Mesh Node backed by libp2p + Kademlia DHT.
 *
 * Provides capability advertisement via CID-based content routing
 * and decentralized peer discovery.
 */
export class MeshNode {
	private node: Libp2p | null = null;
	private config: MeshNodeConfig;
	private manifestDialFailureState: Map<
		string,
		{ failures: number; cooldownUntil: number; lastSkipLogAt: number }
	> = new Map();
	private static readonly MANIFEST_DIAL_BASE_COOLDOWN_MS = 10_000;
	private static readonly MANIFEST_DIAL_MAX_COOLDOWN_MS = 2 * 60_000;
	private static readonly MANIFEST_DIAL_SKIP_LOG_THROTTLE_MS = 30_000;

	/**
	 * Buffer of capability hashes that have been announced.
	 * Used to re-announce capabilities when new peers connect
	 * (critical for small / isolated clusters where the initial
	 * provide() finds zero peers in the routing table).
	 */
	private announcedCapabilities: Set<string> = new Set();

	/** Guards against concurrent re-announcement storms. */
	private reannouncing = false;

	/** Callback that returns the local node's manifest on request. */
	private manifestProvider: (() => LiopManifest) | null = null;

	/** Flag to ensure the manifest protocol is only registered once. */
	private manifestProtocolRegistered = false;

	/** Local Ed25519 Private Key for protocol signatures */
	// biome-ignore lint/suspicious/noExplicitAny: libp2p keys type
	private localPrivateKey: any | null = null;

	constructor(config: MeshNodeConfig = {}) {
		this.config = {
			listenAddresses: config.listenAddresses || [
				"/ip4/0.0.0.0/tcp/0/ws",
				"/ip4/0.0.0.0/tcp/0",
			],
			bootstrapNodes: config.bootstrapNodes || [],
			identityPath: config.identityPath,
			enableWAN: config.enableWAN ?? false,
			dhtStoragePath: config.dhtStoragePath,
			addressMapper: config.addressMapper,
			swarmKey: config.swarmKey,
		};
	}

	private shouldSkipManifestDial(peerIdStr: string): boolean {
		const state = this.manifestDialFailureState.get(peerIdStr);
		if (!state) return false;
		const now = Date.now();
		if (now >= state.cooldownUntil) return false;
		if (
			now - state.lastSkipLogAt >
			MeshNode.MANIFEST_DIAL_SKIP_LOG_THROTTLE_MS
		) {
			log.info(
				`[LIOP-Mesh] Skipping manifest dial for ${peerIdStr} during cooldown (${Math.ceil((state.cooldownUntil - now) / 1000)}s remaining)`,
			);
			state.lastSkipLogAt = now;
		}
		return true;
	}

	private recordManifestDialFailure(peerIdStr: string): void {
		const now = Date.now();
		const prev = this.manifestDialFailureState.get(peerIdStr);
		const failures = (prev?.failures || 0) + 1;
		const backoff = Math.min(
			MeshNode.MANIFEST_DIAL_BASE_COOLDOWN_MS * 2 ** Math.max(0, failures - 1),
			MeshNode.MANIFEST_DIAL_MAX_COOLDOWN_MS,
		);
		this.manifestDialFailureState.set(peerIdStr, {
			failures,
			cooldownUntil: now + backoff,
			lastSkipLogAt: 0,
		});
	}

	private clearManifestDialFailure(peerIdStr: string): void {
		this.manifestDialFailureState.delete(peerIdStr);
	}

	/**
	 * Loads a persistent identity from disk or generates a new Ed25519 keypair.
	 * Uses privateKeyToProtobuf/privateKeyFromProtobuf (libp2p v3.x official API).
	 */
	private async loadOrCreateIdentity() {
		try {
			const { generateKeyPair, privateKeyFromProtobuf } = (await import(
				"@libp2p/crypto/keys"
				// biome-ignore lint/suspicious/noExplicitAny: <libp2p type workaround>
			)) as any;
			const { fromString: u8FromString } = await import(
				"uint8arrays/from-string"
			);

			if (this.config.identityPath) {
				const absolutePath = path.resolve(this.config.identityPath);
				try {
					const data = await fs.readFile(absolutePath, "utf-8");
					const json = JSON.parse(data);
					const protobufBytes = u8FromString(json.privKey, "base64");
					try {
						const privateKey = privateKeyFromProtobuf(protobufBytes);
						log.info(
							`[LIOP-Mesh] Loaded persistent identity from ${absolutePath}`,
						);
						return { privateKey, isNew: false };
					} catch (parseError: unknown) {
						log.error(
							`[LIOP-Mesh] Persistent identity at ${absolutePath} is invalid or corrupt. Generating new one. Error: ${
								parseError instanceof Error
									? parseError.message
									: String(parseError)
							}`,
						);
						// Fall through to generate new key
					}
				} catch (error: unknown) {
					const e = error as Error & { code?: string };
					if (e.code !== "ENOENT") {
						log.error(`[LIOP-Mesh] Error loading identity: ${e.message}`);
					}
				}
			}

			const privateKey = await generateKeyPair("Ed25519");
			return { privateKey, isNew: true };
		} catch (error) {
			log.error(
				`[LIOP-Mesh] Critical error in identity management: ${error}. Falling back to ephemeral identity.`,
			);

			// EPOCH FALLBACK: In extreme cases (corrupt env), use a volatile in-memory identity
			// to allow the node to start and serve traffic.
			try {
				const { generateKeyPair } = (await import(
					"@libp2p/crypto/keys"
					// biome-ignore lint/suspicious/noExplicitAny: libp2p ESM dynamic import type workaround
				)) as any;
				const ephemeralKey = await generateKeyPair("Ed25519");
				return { privateKey: ephemeralKey, isNew: true };
			} catch (fallbackError) {
				throw new Error(`Identity system failure: ${fallbackError}`);
			}
		}
	}

	/**
	 * Persists the private key to disk using protobuf serialization (libp2p v3.x).
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Libp2p private key type is complex for Alpha
	private async saveIdentity(privateKey: any) {
		if (!this.config.identityPath || !this.node) return;

		try {
			const absolutePath = path.resolve(this.config.identityPath);
			const { privateKeyToProtobuf } = (await import(
				"@libp2p/crypto/keys"
				// biome-ignore lint/suspicious/noExplicitAny: <libp2p type workaround>
			)) as any;
			const { toString: u8ToString } = await import("uint8arrays/to-string");

			const protobufBytes = privateKeyToProtobuf(privateKey);
			const privKeyEncoded = u8ToString(protobufBytes, "base64");

			const json = {
				id: this.node.peerId.toString(),
				privKey: privKeyEncoded,
			};

			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await fs.writeFile(absolutePath, JSON.stringify(json, null, 2));
			log.info(`[LIOP-Mesh] Identity persisted to ${absolutePath}`);
		} catch (error) {
			log.error(`[LIOP-Mesh] FAILED to persist identity: ${error}`);
		}
	}

	/**
	 * Creates a CID v1 (raw codec 0x55) from a SHA-256 hash of the capability string.
	 * Required by @libp2p/kad-dht v16+ for provide/findProviders.
	 */
	private async capabilityToCID(capability: string): Promise<CID> {
		const hash = await sha256.digest(new TextEncoder().encode(capability));
		return CID.create(1, 0x55, hash);
	}

	/**
	 * Re-announces all buffered capabilities after a new peer connects.
	 * Uses a small delay to allow the DHT protocol handshake to complete.
	 */
	private async reannounceAll(): Promise<void> {
		if (
			this.reannouncing ||
			!this.node ||
			this.announcedCapabilities.size === 0
		)
			return;

		this.reannouncing = true;
		try {
			// Wait for the DHT protocol handshake to settle
			await new Promise((resolve) => setTimeout(resolve, 500));

			if (!this.node) return;

			log.info(
				`[LIOP-Mesh] Re-announcing ${this.announcedCapabilities.size} capabilities to updated routing table...`,
			);

			for (const hash of this.announcedCapabilities) {
				try {
					const cid = await this.capabilityToCID(hash);
					await this.node.contentRouting.provide(cid);
					log.info(`[LIOP-Mesh] Re-announced: ${hash}`);
				} catch (_e) {
					log.info(`[LIOP-Mesh] Re-announce failed for ${hash}: ${_e}`);
				}
			}
		} finally {
			this.reannouncing = false;
		}
	}

	async start(): Promise<void> {
		if (this.node) return;
		const result = await this.loadOrCreateIdentity();
		if (!result) throw new Error("Could not initialize P2P Identity");

		const { privateKey, isNew } = result;
		this.localPrivateKey = privateKey;

		let bootNodes = this.config.bootstrapNodes || [];
		if (bootNodes.length === 0 && this.config.enableWAN) {
			bootNodes = DEFAULT_BOOTSTRAP_NODES;
		}

		const enableAutoNAT = this.config.enableAutoNAT ?? true;
		const enableRelay = this.config.enableRelay ?? true;
		const enableDcutr = this.config.enableDcutr ?? true;
		const enableMdns = this.config.enableMdns ?? !this.config.enableWAN;

		// biome-ignore lint/suspicious/noExplicitAny: discovery polymorphic list
		const discoveryList: any[] = [];
		if (bootNodes.length > 0) {
			discoveryList.push(
				bootstrap({
					list: bootNodes,
				}),
			);
		}
		if (enableMdns) {
			discoveryList.push(mdns());
		}

		const dhtProtocol = this.config.enableWAN
			? "/ipfs/kad/1.0.0"
			: "/ipfs/lan/kad/1.0.0";

		// biome-ignore lint/suspicious/noExplicitAny: transports list
		const transports: any[] = [tcp(), webSockets()];
		if (enableRelay) {
			transports.push(circuitRelayTransport());
		}

		// biome-ignore lint/suspicious/noExplicitAny: services map
		const services: Record<string, any> = {
			identify: identify(),
			ping: ping(),
			dht: kadDHT({
				protocol: dhtProtocol,
				clientMode: false,
				// Allow local/private IPs in the DHT routing table for development/testing
				allowQueryWithZeroPeers: true,
				// By default kadDHT drops local IP addresses. Override the mapper to keep them.
				peerInfoMapper: (peer) => peer,
			}),
		};

		if (enableAutoNAT) {
			services.autoNAT = autoNAT();
		}
		if (enableRelay) {
			services.relay = circuitRelayServer();
		}
		if (enableDcutr) {
			services.dcutr = dcutr();
		}

		// Tier 1 Enclave: Pre-Shared Key (pnet) Connection Protection
		// biome-ignore lint/suspicious/noExplicitAny: ConnectionProtector factory type
		let connectionProtector: any;
		if (this.config.swarmKey) {
			const { preSharedKey } = await import("@libp2p/pnet");
			connectionProtector = preSharedKey({
				psk: this.config.swarmKey,
			});
			log.info(
				"[LIOP-Mesh] 🔒 Private Network (pnet) enabled — transport-layer PSK isolation active",
			);
		}

		this.node = await createLibp2p({
			privateKey,
			addresses: {
				listen: this.config.listenAddresses,
			},
			transports,
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			...(connectionProtector ? { connectionProtector } : {}),
			// biome-ignore lint/suspicious/noExplicitAny: services polymorphic definition
			services: services as any,
			peerDiscovery:
				// biome-ignore lint/suspicious/noExplicitAny: discovery polymorphic list casting
				discoveryList.length > 0 ? (discoveryList as any) : undefined,
		});

		// Monitor Connectivity Events
		this.node.addEventListener("peer:discovery", (evt) => {
			const peerId = evt.detail.id;
			log.info(`[LIOP-Mesh] Discovered peer: ${peerId.toString()}`);
			// [Phase 104] Auto-dial discovered peers to bypass DHT propagation latency
			if (this.node) {
				// biome-ignore lint/suspicious/noExplicitAny: target polymorphic type
				let dialTarget: any = peerId;

				// Apply port translation if necessary (Docker -> Windows Host)
				if (this.config.addressMapper && evt.detail.multiaddrs.length > 0) {
					const translated = evt.detail.multiaddrs
						.map((ma) => {
							// biome-ignore lint/style/noNonNullAssertion: mapped conditionally
							const mapped = this.config.addressMapper!(ma.toString());
							return mapped ? multiaddr(mapped) : null;
						})
						.filter((t): t is NonNullable<typeof t> => t !== null);

					const directTCP = translated.find(
						(ma) =>
							ma.toString().includes("/tcp/") && !ma.toString().includes("/ws"),
					);
					if (directTCP) dialTarget = directTCP;
				}

				this.node.dial(dialTarget).catch(() => {});
			}
		});

		this.node.addEventListener("peer:connect", (evt) => {
			const peerId = evt.detail;
			log.info(`[LIOP-Mesh] Connected to peer: ${peerId.toString()}`);

			if (!this.node) return;
			// biome-ignore lint/suspicious/noExplicitAny: access internal services
			const dht = (this.node.services as any).dht;
			if (dht?.routingTable) {
				log.info(
					`[LIOP-Mesh] Adding ${peerId.toString()} to DHT Routing Table`,
				);
				dht.routingTable.add(peerId).catch((err: unknown) => {
					log.info(
						`[LIOP-Mesh] Failed to add peer to routing table: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
			}

			// Trigger reactive re-announcement of all capabilities
			// so that ADD_PROVIDER messages reach the new peer
			this.reannounceAll().catch((err: unknown) => {
				log.info(
					`[LIOP-Mesh] Re-announce error: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		});

		await this.node.start();

		// Load persisted DHT routing table to enable rapid cold-start reconnections
		await this.loadRoutingTable();

		// [LIOP-ALPHA] Protocols and services setup
		this.applyHandlers();

		if (isNew && this.config.identityPath) {
			await this.saveIdentity(privateKey);
		}

		log.info(
			`[LIOP-Mesh] Node started with id: ${this.node.peerId.toString()}`,
		);
		this.node.getMultiaddrs().forEach((addr) => {
			log.info(`[LIOP-Mesh] Listening on: ${addr.toString()}`);
		});

		// Force explicit dialing of Bootstrap nodes with bounded backoff
		if (bootNodes.length > 0) {
			log.info(
				`[LIOP-Mesh] Forcing direct P2P dial to ${bootNodes.length} bootstrap nodes...`,
			);

			const maxRetries = 5;
			for (const addr of bootNodes) {
				let success = false;
				let attempt = 1;

				while (attempt <= maxRetries && !success) {
					try {
						await this.node.dial(multiaddr(addr));
						log.info(`[LIOP-Mesh] ✅ Successfully dialed ${addr}`);
						success = true;
					} catch (_e) {
						const delay = Math.min(1000 * 2 ** (attempt - 1), 3000);
						log.warn(
							`[LIOP-Mesh] ⚠️ Dial attempt ${attempt}/${maxRetries} to ${addr} failed. Retrying in ${delay / 1000}s...`,
						);
						if (attempt < maxRetries) {
							await new Promise((resolve) => setTimeout(resolve, delay));
						} else {
							log.error(
								`[LIOP-Mesh] ❌ Could not connect to bootstrap ${addr} after ${maxRetries} attempts. Continuing...`,
							);
						}
						attempt++;
					}
				}
			}
		}
	}

	async stop(): Promise<void> {
		if (this.node) {
			await this.saveRoutingTable();
			await this.node.stop();
			log.info("[LIOP-Mesh] Node stopped");
		}
	}

	private async loadRoutingTable() {
		if (!this.config.dhtStoragePath || !this.node) return;
		try {
			const absolutePath = path.resolve(this.config.dhtStoragePath);
			const data = await fs.readFile(absolutePath, "utf-8");
			const peers = JSON.parse(data);
			const { peerIdFromString } = await import("@libp2p/peer-id");

			let loadedCount = 0;
			for (const peer of peers) {
				if (!peer.id || !peer.addresses) continue;
				try {
					const peerId = peerIdFromString(peer.id);
					const addrs = peer.addresses.map((a: string) => multiaddr(a));
					// biome-ignore lint/suspicious/noExplicitAny: bypass libp2p version-drift type mismatch on PeerId
					await this.node.peerStore.save(peerId as any, { multiaddrs: addrs });

					// Pre-seed DHT routing table
					// biome-ignore lint/suspicious/noExplicitAny: Internal service access
					const dht = (this.node.services as any).dht;
					if (dht?.routingTable) {
						dht.routingTable.add(peerId).catch(() => {});
					}
					loadedCount++;
				} catch (_e) {}
			}
			log.info(`[LIOP-Mesh] Loaded ${loadedCount} peers from DHT storage`);
		} catch (error: unknown) {
			const e = error as Error & { code?: string };
			if (e.code !== "ENOENT") {
				log.error(`[LIOP-Mesh] Failed to load DHT table: ${e.message}`);
			}
		}
	}

	private async saveRoutingTable() {
		if (!this.config.dhtStoragePath || !this.node) return;
		try {
			const absolutePath = path.resolve(this.config.dhtStoragePath);
			const allPeers = await this.node.peerStore.all();
			const peersToSave = [];
			for (const peer of allPeers) {
				if (peer.addresses.length > 0) {
					peersToSave.push({
						id: peer.id.toString(),
						// biome-ignore lint/suspicious/noExplicitAny: internal libp2p addr
						addresses: peer.addresses.map((a: any) => a.multiaddr.toString()),
					});
				}
			}
			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await fs.writeFile(absolutePath, JSON.stringify(peersToSave, null, 2));
			log.info(`[LIOP-Mesh] Saved ${peersToSave.length} peers to DHT storage`);
		} catch (error) {
			log.error(`[LIOP-Mesh] FAILED to save DHT routing table: ${error}`);
		}
	}

	/**
	 * Internal logic to register protocol handlers against the libp2p node.
	 * Can be called multiple times; handles idempotent registration.
	 */
	private applyHandlers(): void {
		if (!this.node || this.manifestProtocolRegistered) return;
		if (!this.manifestProvider) return;

		this.manifestProtocolRegistered = true;

		// Announce manifest capability to the Mesh DHT for discovery
		this.announceCapability(LIOP_MANIFEST_CAPABILITY).catch((err) => {
			log.info(`[LIOP-Mesh] Initial manifest announcement failed: ${err}`);
		});

		// libp2p v3.x: handler receives (stream, connection) as separate args
		this.node.handle(
			LIOP_MANIFEST_PROTOCOL,
			// biome-ignore lint/suspicious/noExplicitAny: libp2p v3.x stream/connection types
			async (streamArg: any, connectionArg?: any) => {
				// v3.x passes (stream, connection); v1.x passed ({ stream, connection })
				const stream = streamArg?.stream ?? streamArg;
				const conn = streamArg?.connection ?? connectionArg;
				const remotePeer = conn?.remotePeer?.toString() || "unknown";

				log.info(`[LIOP-Mesh] Incoming manifest request from ${remotePeer}.`);

				try {
					const manifest = this.manifestProvider?.();
					if (!manifest || !stream) {
						log.info(
							`[LIOP-Mesh] Skipping manifest request (no provider or stream)`,
						);
						try {
							if (typeof stream?.close === "function") await stream.close();
						} catch (_e) {}
						return;
					}

					const manifestStr = JSON.stringify(manifest);
					const payload = new TextEncoder().encode(manifestStr);

					// Write length-prefixed payload (Big Endian 4 bytes)
					const lengthBuf = Buffer.alloc(4);
					lengthBuf.writeUInt32BE(payload.length, 0);
					const fullPacket = Buffer.concat([lengthBuf, Buffer.from(payload)]);

					log.info(
						`[LIOP-Mesh] Serving manifest (${fullPacket.length} bytes) to ${remotePeer} [Tools: ${manifest.tools.map((t) => t.name).join(", ")}]`,
					);

					try {
						// libp2p v3.x: stream.send() for writing
						if (typeof stream.send === "function") {
							const accepted = stream.send(fullPacket);
							if (!accepted && typeof stream.onDrain === "function") {
								try {
									await stream.onDrain({ signal: AbortSignal.timeout(5000) });
								} catch (drainErr) {
									log.info(
										`[LIOP-Mesh] WARN: Drain timeout for ${remotePeer}: ${drainErr instanceof Error ? drainErr.message : String(drainErr)}`,
									);
								}
							}
						} else {
							// Fallback for environments where stream.send is not available
							await pipe([fullPacket], stream);
						}
						log.info(`[LIOP-Mesh] Manifest sent successfully to ${remotePeer}`);
					} catch (writeErr: unknown) {
						log.info(
							`[LIOP-Mesh] Write error serving manifest to ${remotePeer}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
						);
					} finally {
						try {
							if (typeof stream.close === "function") await stream.close();
						} catch (_e) {
							// Ignore close errors
						}
					}
					return;
				} catch (err: unknown) {
					log.info(
						`[LIOP-Mesh] Error serving manifest to ${remotePeer}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
		);

		log.info(
			`[LIOP-Mesh] Manifest Protocol registered: ${LIOP_MANIFEST_PROTOCOL}`,
		);
	}

	/**
	 * Registers a callback as the manifest provider.
	 * Will be applied immediately if the node is already initialized.
	 */
	registerManifestHandler(provider: () => LiopManifest): void {
		this.manifestProvider = provider;
		if (this.node) {
			this.applyHandlers();
		}
	}

	/**
	 * Queries a remote peer's manifest by opening a /liop/manifest/1.0.0 stream.
	 * Returns null if the peer doesn't support the protocol or is unreachable.
	 */
	async queryManifest(peerIdStr: string): Promise<LiopManifest | null> {
		if (!this.node) throw new Error("Mesh Node is not running");

		// [ALPHA-OPTIMIZATION] Local Loopback Bypass
		// If we are querying our own manifest, return it directly from the provider.
		if (peerIdStr === this.node.peerId.toString()) {
			log.info(
				`[LIOP-Mesh] Loopback: Returning local manifest directly for ${peerIdStr}`,
			);
			return this.manifestProvider?.() || null;
		}
		if (this.shouldSkipManifestDial(peerIdStr)) {
			return null;
		}

		const MAX_ATTEMPTS = 3;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				type DialTarget = Parameters<Libp2p["dialProtocol"]>[0];

				// biome-ignore lint/suspicious/noExplicitAny: targetPeer can be from connections or from string
				let targetPeer: any = null;
				const connections = this.node.getConnections();
				const activeConn = connections.find(
					(c) => c.remotePeer.toString() === peerIdStr,
				);

				if (activeConn) {
					targetPeer = activeConn.remotePeer;
				} else {
					// Fallback: search peerStore to find a valid PeerId object that libp2p understands natively
					const allPeers = await this.node.peerStore.all();
					const stored = allPeers.find((p) => p.id.toString() === peerIdStr);
					if (stored) {
						targetPeer = stored.id;
					} else {
						// Final fallback parsing.
						// [LIOP-CAUTION] This is where the toMultihash error usually triggers if libp2p version drift exists.
						const { peerIdFromString } = await import("@libp2p/peer-id");
						targetPeer = peerIdFromString(peerIdStr);
					}
				}

				// [LIOP-PORT-TRANSLATION] If an address mapper is configured (e.g. in the Host Agent),
				// ensure the targetPeer's addresses are translated before libp2p attempts to dial.
				const dialTargetFromPeer = targetPeer as DialTarget;
				let dialTarget: DialTarget = dialTargetFromPeer;
				if (this.config.addressMapper && this.node) {
					const mapper = this.config.addressMapper;
					const peer = await this.node.peerStore.get(targetPeer);
					if (peer && peer.addresses.length > 0) {
						const translated = peer.addresses
							.map((oa) => {
								const original = oa.multiaddr.toString();
								const mapped = mapper(original);
								if (!mapped) return null;
								return {
									isCertified: oa.isCertified,
									multiaddr: multiaddr(mapped),
								};
							})
							.filter((t): t is NonNullable<typeof t> => t !== null);

						// Strategy: Force direct dial to the first translated TCP address to bypass DHT routing delays
						const directTCP = translated.find(
							(t) =>
								t.multiaddr.toString().includes("/tcp/") &&
								!t.multiaddr.toString().includes("/ws"),
						);
						if (directTCP) {
							dialTarget = directTCP.multiaddr as DialTarget;
							log.info(
								`[LIOP-Mesh] ⚡ Direct dial to translated addr: ${dialTarget.toString()}`,
							);
						}

						// Update the peerStore so subsequent dials also use the right path
						// biome-ignore lint/suspicious/noExplicitAny: access internal peerStore
						await (this.node as any).peerStore.save(targetPeer, {
							multiaddrs: translated.map((t) => t.multiaddr),
						});
					}
				}

				// Open a protocol stream using high-level dialProtocol for automated it-stream wrapping
				// biome-ignore lint/suspicious/noExplicitAny: stream type varies by transport
				let stream: any;
				try {
					// biome-ignore lint/suspicious/noExplicitAny: libp2p returns polymorphic dialProtocol result
					const result: any = await this.node
						.dialProtocol(dialTarget, LIOP_MANIFEST_PROTOCOL)
						.catch((e: unknown) => {
							// Catch specific TypeError that breaks the loop
							if (String(e).includes("toMultihash")) {
								throw new Error("INCOMPATIBLE_PEER_ID_INTERFACE");
							}
							throw e;
						});
					stream = result.stream || result;
				} catch (dialErr) {
					if (attempt === MAX_ATTEMPTS) {
						log.info(
							`[LIOP-Mesh] Dial error for ${peerIdStr} after ${MAX_ATTEMPTS} attempts: ${dialErr}`,
						);
						return null;
					}
					const delay = 500 * 2 ** attempt;
					log.info(
						`[LIOP-Mesh] Dial error for ${peerIdStr} (Attempt ${attempt}). Retrying in ${delay}ms...`,
					);
					await new Promise((r) => setTimeout(r, delay));
					continue;
				}

				// libp2p v3.x: stream IS the AsyncIterable<Uint8Array>
				// v1.x had stream.source; v3.x has the stream itself as iterable
				const source: AsyncIterable<Uint8Array> =
					stream.source ??
					(typeof stream[Symbol.asyncIterator] === "function" ? stream : null);

				if (!source) {
					throw new Error("Target stream has no AsyncIterable source");
				}

				const chunks: Uint8Array[] = [];
				let totalReceived = 0;
				let expectedPayloadLength = -1;

				// Read length-prefixed manifest: first 4 bytes = payload length (BE)
				let manifestTimeoutId: NodeJS.Timeout | undefined;
				const timeoutPromise = new Promise<never>((_, reject) => {
					manifestTimeoutId = setTimeout(
						() => reject(new Error("Manifest read timeout (5.0s)")),
						5000,
					);
				});

				try {
					await Promise.race([
						(async () => {
							for await (const chunk of source) {
								if (!chunk) continue;
								// libp2p streams yield Uint8ArrayList (from uint8arraylist package)
								// which reports .length correctly but Buffer.from() produces zeros.
								// .subarray() returns a flat contiguous Uint8Array with actual data.
								const raw =
									// biome-ignore lint/suspicious/noExplicitAny: Uint8ArrayList type guard
									typeof (chunk as any).subarray === "function"
										? (chunk as { subarray: () => Uint8Array }).subarray()
										: chunk instanceof Uint8Array
											? chunk
											: new Uint8Array(0);
								const bytes = Buffer.from(
									raw.buffer,
									raw.byteOffset,
									raw.byteLength,
								);

								if (bytes.length > 0) {
									chunks.push(bytes);
									totalReceived += bytes.length;

									// Extract expected length from the first 4 bytes once available
									if (expectedPayloadLength < 0 && totalReceived >= 4) {
										const header = Buffer.concat(chunks);
										expectedPayloadLength = header.readUInt32BE(0);
									}

									// Stop reading once we have the full payload (4 prefix + N payload)
									if (
										expectedPayloadLength >= 0 &&
										totalReceived >= 4 + expectedPayloadLength
									) {
										break;
									}
								}
							}
						})(),
						timeoutPromise,
					]);
				} catch (itErr: unknown) {
					if (chunks.length === 0) throw itErr;
					log.info(
						`[LIOP-Mesh] Partial manifest read from ${peerIdStr}: ${itErr instanceof Error ? itErr.message : String(itErr)}`,
					);
				} finally {
					if (manifestTimeoutId) clearTimeout(manifestTimeoutId);
				}

				const raw = Buffer.concat(chunks);
				if (raw.length < 4) {
					throw new Error("Received empty/invalid manifest (too short)");
				}

				// Use the length prefix to extract exactly the expected JSON
				const declaredLen = raw.readUInt32BE(0);
				const jsonStr = raw.subarray(4, 4 + declaredLen).toString("utf-8");
				const manifest: LiopManifest = JSON.parse(jsonStr);

				log.info(
					`[LIOP-Mesh] Received manifest from ${peerIdStr}: ${manifest.tools.length} tools`,
				);
				this.clearManifestDialFailure(peerIdStr);

				return manifest;
			} catch (err: unknown) {
				if (attempt === MAX_ATTEMPTS) {
					this.recordManifestDialFailure(peerIdStr);
					log.info(
						`[LIOP-Mesh] Failed to query manifest from ${peerIdStr} after ${MAX_ATTEMPTS} attempts: ${err instanceof Error ? err.message : String(err)}`,
					);
					return null;
				}
				const delay = 500 * 2 ** attempt;
				log.info(
					`[LIOP-Mesh] Query error for ${peerIdStr} (Attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`,
				);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
		return null;
	}

	/**
	 * Discovers all peers in the DHT that have announced "liop:manifest".
	 * Returns their PeerIDs for subsequent manifest queries.
	 */
	async discoverManifestProviders(): Promise<string[]> {
		return this.findProviders(LIOP_MANIFEST_CAPABILITY);
	}

	/**
	 * Announces this node as a manifest provider in the DHT.
	 * Should be called after tools/resources have been registered.
	 */
	async announceManifest(): Promise<void> {
		await this.announceCapability(LIOP_MANIFEST_CAPABILITY);
	}

	/**
	 * Returns the current size of the routing table for diagnostic purposes.
	 */
	getRoutingTableSize(): number {
		if (!this.node) return 0;
		// @ts-expect-error: Accessing internal routing table size for diagnostics
		return this.node.services.dht?.routingTable?.size || 0;
	}

	getPeerId(): string {
		if (!this.node) throw new Error("Mesh Node is not running");
		return this.node.peerId.toString();
	}

	async sign(data: Uint8Array): Promise<Uint8Array> {
		if (!this.localPrivateKey) {
			throw new Error("Local identity not loaded or initialized");
		}
		// libp2p private key implementations typically return a Promise<Uint8Array> or Uint8Array
		return Buffer.from(await this.localPrivateKey.sign(data));
	}

	getMultiaddrs(): string[] {
		if (!this.node) throw new Error("Mesh Node is not running");
		return this.node.getMultiaddrs().map((a) => a.toString());
	}

	async announceCapability(hash: string): Promise<void> {
		if (!this.node) throw new Error("Mesh Node is not running");

		// Buffer the capability for reactive re-announcement
		this.announcedCapabilities.add(hash);

		try {
			const cid = await this.capabilityToCID(hash);
			log.info(
				`[LIOP-Mesh] Announcing capability: ${hash} (CID: ${cid.toString()})`,
			);

			// In libp2p v1.x, contentRouting.provide returns Promise<void>
			await this.node.contentRouting.provide(cid);
			log.info(`[LIOP-Mesh] Successfully announced capability: ${hash}`);

			// [DEV-ONLY] Self-verification
			const selfId = this.node.peerId.toString();
			for await (const peer of this.node.contentRouting.findProviders(cid)) {
				if (peer.id.toString() === selfId) {
					log.info(
						`[LIOP-Mesh] Self-verification success: Node is providing ${hash}`,
					);
					break;
				}
			}
		} catch (error) {
			log.error(`[LIOP-Mesh] Failed to announce capability: ${error}`);
		}
	}

	async findProviders(hash: string): Promise<string[]> {
		if (!this.node) throw new Error("Mesh Node is not running");
		const providers: string[] = [];
		try {
			const cid = await this.capabilityToCID(hash);
			log.info(
				`[LIOP-Mesh] Querying DHT for ${hash} (CID: ${cid.toString()})...`,
			);

			let foundAny = false;

			// Phase 103: Adaptive Tail-Wait Polling for DHT Discovery
			const connections = this.node.getConnections?.()?.length || 0;
			const idleTimeoutMs = connections > 1 ? 1500 : 3000;
			log.info(
				`[LIOP-Mesh] Starting DHT search with intelligent idle-timeout of ${idleTimeoutMs}ms (Active connections: ${connections})`,
			);

			// We manually iterate the AsyncIterable to abort it via Promise.race
			const iterator = this.node.contentRouting
				.findProviders(cid)
				[Symbol.asyncIterator]();
			let isDone = false;

			while (!isDone) {
				const nextPromise = iterator.next();
				const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
					setTimeout(() => resolve({ timeout: true }), idleTimeoutMs),
				);

				try {
					const result = await Promise.race([nextPromise, timeoutPromise]);

					if (result && typeof result === "object" && "timeout" in result) {
						log.info(
							`[LIOP-Mesh] DHT discovery idle-timeout reached. Stopping search early.`,
						);
						if (typeof iterator.return === "function") {
							// Fire-and-forget: Kademlia iterators can block for 30s on return()
							iterator.return().catch(() => {});
						}
						isDone = true;
						break;
					}

					// biome-ignore lint/suspicious/noExplicitAny: polymorphic Kademlia peer result
					const itResult = result as IteratorResult<any>;
					if (itResult.done) {
						isDone = true;
						break;
					}

					foundAny = true;
					const peer = itResult.value;
					const peerId = peer.id.toString();
					log.info(`[LIOP-Mesh] Found provider: ${peerId}`);
					if (!providers.includes(peerId)) {
						providers.push(peerId);
					}
				} catch (e: unknown) {
					log.warn(
						`[LIOP-Mesh] DHT iteration error: ${e instanceof Error ? e.message : String(e)}`,
					);
					isDone = true;
					break;
				}
			}

			if (!foundAny) {
				const services = this.node.services as {
					dht?: { routingTable?: { size: number } };
				};
				const dhtSize = services.dht?.routingTable?.size || 0;
				log.info(
					`[LIOP-Mesh] DHT search for ${hash} returned zero results (routing table size: ${dhtSize})`,
				);
			}

			// [DEVELOPER-EXPERIENCE] Local Loopback Discovery
			// If we are providing this capability, ensure we find ourselves even if DHT findProviders doesn't return us.
			if (this.announcedCapabilities.has(hash)) {
				const selfId = this.node.peerId.toString();
				if (!providers.includes(selfId)) {
					log.info(
						`[LIOP-Mesh] Including local node (${selfId}) in results for ${hash}`,
					);
					providers.push(selfId);
				}
			}
		} catch (error: unknown) {
			log.info(
				`[LIOP-Mesh] Error finding providers for ${hash}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		log.info(
			`[LIOP-Mesh] DHT search for ${hash} finished. Found ${providers.length} providers.`,
		);
		return providers;
	}

	async resolvePeer(peerIdStr: string): Promise<string[]> {
		if (!this.node) throw new Error("Mesh Node is not running");
		try {
			// Strategy 1: Check active connections for the peer's multiaddrs
			const connections = this.node.getConnections();
			for (const conn of connections) {
				if (conn.remotePeer.toString() === peerIdStr) {
					const remoteAddr = conn.remoteAddr.toString();
					log.info(
						`[LIOP-Mesh] Resolved peer ${peerIdStr} via active connection: ${remoteAddr}`,
					);
					return [remoteAddr];
				}
			}

			// Strategy 2: Try peerStore (iterate all peers to avoid toMultihash conflict)
			const allPeers = await this.node.peerStore.all();
			for (const peer of allPeers) {
				if (peer.id.toString() === peerIdStr && peer.addresses.length > 0) {
					// biome-ignore lint/suspicious/noExplicitAny: Internal libp2p addr type
					const addrs = peer.addresses.map((a: any) => a.multiaddr.toString());
					log.info(
						`[LIOP-Mesh] Resolved peer ${peerIdStr} via peerStore: ${addrs[0]}`,
					);
					return addrs;
				}
			}

			log.info(
				`[LIOP-Mesh] Peer ${peerIdStr} not found in connections or peerStore`,
			);
		} catch (error) {
			log.info(`[LIOP-Mesh] Failed to resolve peer ${peerIdStr}: ${error}`);
		}
		return [];
	}

	public isStarted(): boolean {
		return !!this.node && this.node.status === "started";
	}

	public getPeers(): string[] {
		if (!this.node) return [];
		return this.node.getConnections().map((c) => c.remotePeer.toString());
	}

	/**
	 * Returns true if this MeshNode was booted inside an isolated libp2p private network (pnet PSK).
	 */
	public isPrivateNetwork(): boolean {
		return Boolean(this.config.swarmKey);
	}

	/**
	 * Returns the configured 95-byte Swarm Key, or undefined if running in a public/consortium mesh.
	 */
	public getSwarmKey(): Uint8Array | undefined {
		return this.config.swarmKey;
	}
}
