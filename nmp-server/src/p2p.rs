// Network Mesh Abstraction - Peer-to-Peer Zero-Trust (libp2p)
// Encapsulates the DHT and the Noise Protocol logic.

use libp2p::{
    core::upgrade::Version,
    identity, noise,
    swarm::{NetworkBehaviour, SwarmBuilder},
    tcp, yamux, PeerId, Swarm, Transport,
};
use std::error::Error;
use std::time::Duration;

#[derive(NetworkBehaviour)]
pub struct NmpMeshBehaviour {
    // Kademlia Distributed Hash Table for Peer Discovery without central DNS
    pub kademlia: libp2p::kad::Kademlia<libp2p::kad::record::store::MemoryStore>,
}

pub fn build_mesh_swarm() -> Result<Swarm<NmpMeshBehaviour>, Box<dyn Error>> {
    println!("Init Zero-Trust Mesh Crypto...");

    // 1. Generate local cryptographic identity (Ed25519)
    // In NMP, this replaces the need for Central mTLS authorities. The PeerId IS the SPIFFE identity loosely.
    let local_key = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    println!("[-] Local Agent Identity (PeerID): {}", local_peer_id);

    // 2. Build Transport (TCP + Noise Encryption + Yamux Multiplexing)
    let transport = tcp::tokio::Transport::new(tcp::Config::default().nodelay(true))
        .upgrade(Version::V1Lazy)
        .authenticate(noise::Config::new(&local_key)?)
        .multiplex(yamux::Config::default())
        .boxed();

    // 3. Setup Kademlia DHT
    let store = libp2p::kad::record::store::MemoryStore::new(local_peer_id);
    let mut kad_config = libp2p::kad::KademliaConfig::default();
    kad_config.set_query_timeout(Duration::from_secs(5 * 60));

    let behaviour = NmpMeshBehaviour {
        kademlia: libp2p::kad::Kademlia::with_config(local_peer_id, store, kad_config),
    };

    // 4. Build Swarm
    let swarm = SwarmBuilder::with_tokio_executor(transport, behaviour, local_peer_id).build();

    Ok(swarm)
}
