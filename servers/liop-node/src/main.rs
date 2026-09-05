// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// Logic-Injection-on-Origin Protocol (LIOP) - Server Node (Data Host)
// This node holds the data and provides a Zero-Trust Wasmtime sandbox for execution.

use futures::StreamExt;
use libp2p::kad::store::RecordStore;
use std::error::Error;
use tracing::info;

mod config;
pub mod executor;
pub mod grpc;
mod guardian;
mod health;
pub mod p2p;
mod tee;
pub mod zk;

use tee::{AwsNitroEnclaveStub, EnclaveProvider};

use grpc::LiopService;
use liop_core::v1::logic_mesh_server::LogicMeshServer;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize structured logging (JSON format via RUST_LOG env filter)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(true)
        .init();

    info!("LIOP Server Node - Initiating Genesis Boot Sequence");

    // Load configuration from file or defaults
    let config = config::LiopConfig::load()?;
    info!(
        grpc_addr = %config.server.grpc_addr,
        p2p_listen = %config.server.p2p_listen,
        p2p_quic_listen = %config.server.p2p_quic_listen,
        fuel_limit = config.sandbox.fuel_limit,
        session_ttl = config.session.ttl_seconds,
        tls_enabled = config.security.tls_enabled,
        "Configuration loaded"
    );

    // Phase 4: Hardware Enclave (TEE) Bootstrapping Stub
    let enclave = AwsNitroEnclaveStub;
    enclave.attest_and_boot()?;
    let _report = enclave.generate_attestation_report(b"liop-nonce-1234")?;

    // Boot up the Zero-Trust WASM Engine
    info!("Loading Sandbox capabilities (Wasmtime+WASI)");
    let sandbox_engine = executor::create_wasi_engine()?;

    // Setup gRPC Server routing
    let addr = config.server.grpc_addr.parse().unwrap();
    let liop_service = LiopService::new(
        sandbox_engine,
        config.session.ttl_duration(),
        config.sandbox.fuel_limit,
        config.sandbox.allowed_dir.clone(),
    );

    info!(addr = %addr, "Starting LIOP gRPC Service");
    let grpc_future = Server::builder()
        .add_service(LogicMeshServer::new(liop_service))
        .serve(addr);

    // Initialize Libp2p generic mesh presence (Kademlia/Noise)
    let mut swarm = p2p::build_mesh_swarm()?;

    // Listen on configured interfaces
    swarm.listen_on(config.server.p2p_listen.parse()?)?;
    swarm.listen_on(config.server.p2p_quic_listen.parse()?)?;

    // Publish Capabilities to DHT (Zero ListTools Routing)
    info!("Publishing Tool Schemas to Kademlia DHT");
    let capabilities_json = r#"{
        "tools": [{
            "name": "analyze_logs_in_origin",
            "description": "Scans voluminous log files directly on the server sandbox",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": { "type": "string" }
                }
            }
        }]
    }"#;

    let record_key = libp2p::kad::RecordKey::new(&"liop:capabilities:LocalLogAnalyzer");
    let record = libp2p::kad::Record {
        key: record_key,
        value: capabilities_json.as_bytes().to_vec(),
        publisher: None,
        expires: None,
    };

    let _ = swarm.behaviour_mut().kademlia.store_mut().put(record);
    info!("Capabilities cached successfully on the P2P Mesh");

    // Enter the networking event loop
    info!("Entering Agent Mesh Network Loop");
    let p2p_future = async move {
        loop {
            tokio::select! {
                 event = swarm.select_next_some() => {
                     if let libp2p::swarm::SwarmEvent::NewListenAddr { address, .. } = event {
                         info!(address = %address, "LIOP Node P2P Mesh ready");
                     }
                 }
            }
        }
    };

    // Start health check HTTP endpoint (parallel to gRPC)
    let health_addr: std::net::SocketAddr = "[::1]:50052".parse().unwrap();
    let health_future = health::start_health_server(health_addr);

    // Run the P2P Mesh, gRPC Engine, and Health Check concurrently
    let _ = tokio::join!(grpc_future, p2p_future, health_future);

    Ok(())
}
