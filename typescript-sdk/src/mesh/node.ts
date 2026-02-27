import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { kadDHT } from "@libp2p/kad-dht";
import { mplex } from "@libp2p/mplex";
import { noise } from "@libp2p/noise";
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
				dht: kadDHT({
					kBucketSize: 20,
					clientMode: false,
					// biome-ignore lint/suspicious/noExplicitAny: <Bypassing strict type confilct in DHT factory>
				}) as any,
				identify: identify(),
			},
		});

		await this.node.start();
		console.log(
			`NMP Mesh Node started with id: ${this.node.peerId.toString()}`,
		);

		this.node.getMultiaddrs().forEach((addr) => {
			console.log(`Listening on: ${addr.toString()}`);
		});
	}

	async stop(): Promise<void> {
		if (this.node) {
			await this.node.stop();
			console.log("NMP Mesh Node stopped");
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
}
