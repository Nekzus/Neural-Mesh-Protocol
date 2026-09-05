// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// Network Mesh Abstraction - Peer-to-Peer Zero-Trust (libp2p)
// Encapsulates the DHT and the Noise Protocol logic.

use libp2p::{identity, noise, swarm::NetworkBehaviour, tcp, yamux, PeerId, StreamProtocol, Swarm};
use std::error::Error;
use std::time::Duration;
use tracing::info;

#[derive(NetworkBehaviour)]
pub struct LiopMeshBehaviour {
    // Kademlia Distributed Hash Table for Peer Discovery without central DNS
    pub kademlia: libp2p::kad::Behaviour<libp2p::kad::store::MemoryStore>,
}

pub fn build_mesh_swarm() -> Result<Swarm<LiopMeshBehaviour>, Box<dyn Error>> {
    info!("Initializing Zero-Trust Mesh Crypto");

    // 1. Generate local cryptographic identity (Ed25519)
    // In LIOP, this replaces the need for Central mTLS authorities. The PeerId IS the SPIFFE identity loosely.
    let local_key = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(local_key.public());
    info!(peer_id = %local_peer_id, "Local Agent Identity established");

    // 2. Setup Kademlia DHT
    let store = libp2p::kad::store::MemoryStore::new(local_peer_id);
    let mut kad_config = libp2p::kad::Config::new(StreamProtocol::new("/liop/kad/1.0.0"));
    kad_config.set_query_timeout(Duration::from_secs(5 * 60));

    let behaviour = LiopMeshBehaviour {
        kademlia: libp2p::kad::Behaviour::with_config(local_peer_id, store, kad_config),
    };

    // 3. Build Swarm (TCP + Noise Encryption + Yamux Multiplexing, and QUIC)
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
