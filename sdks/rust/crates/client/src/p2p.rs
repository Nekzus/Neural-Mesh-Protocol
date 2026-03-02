// Network Mesh Abstraction - Client peer Builder

use libp2p::{
    core::upgrade::Version,
    identity, noise,
    swarm::{NetworkBehaviour, SwarmBuilder},
    tcp, yamux, PeerId, Swarm, Transport,
};
use std::error::Error;
use std::time::Duration;
// Neural Mesh Protocol Agent Protocol Base
#[derive(NetworkBehaviour)]
pub struct NmpClientBehaviour {
    pub kademlia: libp2p::kad::Kademlia<libp2p::kad::record::store::MemoryStore>,
}

pub fn build_client_swarm() -> Result<Swarm<NmpClientBehaviour>, Box<dyn Error>> {
    println!("Init Zero-Trust Mesh Crypto...");
    
    let local_key = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    println!("[-] Local Agent Identity (PeerID): {}", local_peer_id);

    let transport = tcp::tokio::Transport::new(tcp::Config::default().nodelay(true))
        .upgrade(Version::V1Lazy)
        .authenticate(noise::Config::new(&local_key)?)
        .multiplex(yamux::Config::default())
        .boxed();
    // 3. Setup Kademlia DHT for Lookups
    let store = libp2p::kad::record::store::MemoryStore::new(local_peer_id);
    let mut kad_config = libp2p::kad::KademliaConfig::default();
    kad_config.set_query_timeout(Duration::from_secs(5 * 60));
    
    let behaviour = NmpClientBehaviour {
        kademlia: libp2p::kad::Kademlia::with_config(local_peer_id, store, kad_config),
    };

    let swarm = SwarmBuilder::with_tokio_executor(transport, behaviour, local_peer_id).build();

    Ok(swarm)
}
