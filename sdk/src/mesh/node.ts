import { createLibp2p, Libp2p } from "libp2p";
import { noise } from "@libp2p/noise";
import { mplex } from "@libp2p/mplex";
import { webSockets } from "@libp2p/websockets";
import { kadDHT } from "@libp2p/kad-dht";
import { identify } from "@libp2p/identify";

export interface MeshNodeConfig {
    listenAddresses?: string[];
    bootstrapNodes?: string[];
}

export class MeshNode {
    private node: Libp2p | null = null;
    private config: MeshNodeConfig;

    constructor(config: MeshNodeConfig = {}) {
        this.config = {
            listenAddresses: config.listenAddresses || ["/ip4/0.0.0.0/tcp/0/ws"],
            bootstrapNodes: config.bootstrapNodes || [],
        };
    }

    async start(): Promise<void> {
        this.node = await createLibp2p({
            addresses: {
                listen: this.config.listenAddresses,
            },
            transports: [webSockets()],
            connectionEncrypters: [noise()],
            streamMuxers: [mplex()],
            services: {
                dht: kadDHT({
                    kBucketSize: 20,
                    clientMode: false,
                }) as any,
                identify: identify(),
            },
        });

        await this.node.start();
        console.log(`NMP Mesh Node started with id: ${this.node.peerId.toString()}`);

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
