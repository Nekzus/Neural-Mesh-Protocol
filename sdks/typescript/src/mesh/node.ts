import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { kadDHT } from "@libp2p/kad-dht";
import { mplex } from "@libp2p/mplex";
import { noise } from "@libp2p/noise";
import { ping } from "@libp2p/ping";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { createLibp2p, type Libp2p } from "libp2p";

export interface MeshNodeConfig {
	listenAddresses?: string[];
	bootstrapNodes?: string[];
}

export class MeshNode {
	private node: Libp2p | null = null;
	private config: MeshNodeConfig;

	constructor(config: MeshNodeConfig = {}) {
		this.config = {
			// Soporte dual TCP (nmp-server nativo en Rust) y WebSockets (Browsers)
			listenAddresses: config.listenAddresses || [
				"/ip4/0.0.0.0/tcp/0/ws",
				"/ip4/0.0.0.0/tcp/0",
			],
			bootstrapNodes: config.bootstrapNodes || [],
		};
	}

	async start(): Promise<void> {
		this.node = await createLibp2p({
			addresses: {
				listen: this.config.listenAddresses,
			},
			transports: [webSockets(), tcp()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux(), mplex()],
			services: {
				identify: identify(),
				dht: kadDHT({
					protocol: "/nmp/kad/1.0.0",
					clientMode: false,
				}),
				// @ts-ignore: Conflict between @libp2p/peer-collections versions
				ping: ping(),
			},
		});

		await this.node.start();
		console.error(
			`NMP Mesh Node started with id: ${this.node.peerId.toString()}`,
		);

		this.node.getMultiaddrs().forEach((addr) => {
			console.error(`Listening on: ${addr.toString()}`);
		});
	}

	async stop(): Promise<void> {
		if (this.node) {
			await this.node.stop();
			console.error("NMP Mesh Node stopped");
		}
	}

	getPeerId(): string {
		if (!this.node) throw new Error("Mesh Node is not running");
		return this.node.peerId.toString();
	}

	getMultiaddrs(): string[] {
		if (!this.node) throw new Error("Mesh Node is not running");
		return this.node.getMultiaddrs().map((a) => a.toString());
	}

	async announceCapability(hash: string): Promise<void> {
		if (!this.node) throw new Error("Mesh Node is not running");
		// Using Kademlia DHT to announce the capability hash
		// In some libp2p versions, we need to convert string to Uint8Array/CID
		try {
			// biome-ignore lint/suspicious/noExplicitAny: <Accessing dht service potentially different between versions>
			const dht = (this.node.services as any).dht;
			await dht.provide(new TextEncoder().encode(hash));
			console.error(`[NMP-Mesh] Announced capability: ${hash}`);
		} catch (error) {
			console.error(`[NMP-Mesh] Failed to announce capability: ${error}`);
		}
	}

	async findProviders(hash: string): Promise<string[]> {
		if (!this.node) throw new Error("Mesh Node is not running");
		const providers: string[] = [];
		try {
			// biome-ignore lint/suspicious/noExplicitAny: <Accessing dht service>
			const dht = (this.node.services as any).dht;
			for await (const provider of dht.findProviders(new TextEncoder().encode(hash))) {
				providers.push(provider.id.toString());
			}
		} catch (error) {
			console.error(`[NMP-Mesh] Failed to find providers: ${error}`);
		}
		return providers;
	}
}
