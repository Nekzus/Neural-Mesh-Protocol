// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// Network Mesh Abstraction - Client peer Builder

use libp2p::{
    identity, noise,
    swarm::NetworkBehaviour,
    tcp, yamux, PeerId, Swarm, StreamProtocol,
};
use std::error::Error;
use std::time::Duration;
use tracing::info;

// Neural Mesh Protocol Agent Protocol Base
#[derive(NetworkBehaviour)]
pub struct NmpClientBehaviour {
    pub kademlia: libp2p::kad::Behaviour<libp2p::kad::store::MemoryStore>,
}

pub fn build_client_swarm() -> Result<Swarm<NmpClientBehaviour>, Box<dyn Error>> {
    info!("Initializing Zero-Trust Mesh Crypto");
    
    let local_key = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    info!(peer_id = %local_peer_id, "Local Agent Identity established");

    // Setup Kademlia DHT for Lookups
    let store = libp2p::kad::store::MemoryStore::new(local_peer_id);
    let mut kad_config =
        libp2p::kad::Config::new(StreamProtocol::new("/nmp/kad/1.0.0"));
    kad_config.set_query_timeout(Duration::from_secs(5 * 60));
    
    let behaviour = NmpClientBehaviour {
        kademlia: libp2p::kad::Behaviour::with_config(local_peer_id, store, kad_config),
    };

    // Build Swarm (TCP + Noise + Yamux, and QUIC)
    let swarm = libp2p::SwarmBuilder::with_existing_identity(local_key)
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|_| behaviour)?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    Ok(swarm)
}
