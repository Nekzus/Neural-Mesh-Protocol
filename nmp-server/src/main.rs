// Neural Mesh Protocol - Server Node (Data Host)
// This node holds the data and provides a Zero-Trust Wasmtime sandbox for execution.

use std::error::Error;
use futures::StreamExt;

pub mod p2p;
pub mod executor;
pub mod grpc;

use grpc::NmpService;
use nmp_core::v1::neural_mesh_server::NeuralMeshServer;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("NMP Server Node - Initiating Genesis Boot Sequence...");
    
    // Boot up the Zero-Trust WASM Engine
    println!("Loading Sandbox capabilities (Wasmtime+WASI)...");
    let sandbox_engine = executor::create_wasi_engine()?;
    
    // Setup gRPC Server routing
    let addr = "[::1]:50051".parse().unwrap();
    let nmp_service = NmpService::new(sandbox_engine);
    
    println!("[-] Starting NMP gRPC Service on {}", addr);
    let grpc_future = Server::builder()
        .add_service(NeuralMeshServer::new(nmp_service))
        .serve(addr);

    // Initialize Libp2p generic mesh presence (Kademlia/Noise)
    let mut swarm = p2p::build_mesh_swarm()?;
    
    // Listen on all interfaces, randomized port for prototype testing
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;
    
    // Enter the networking event loop
    println!("Entering Agent Mesh Network Loop...");
    let p2p_future = async move {
        loop {
            tokio::select! {
                 event = swarm.select_next_some() => {
                     match event {
                         libp2p::swarm::SwarmEvent::NewListenAddr { address, .. } => {
                             println!("[-] NMP Node P2P Mesh ready on: {}", address);
                         }
                         _ => {}
                     }
                 }
            }
        }
    };

    // Run both the P2P Mesh loop and the gRPC Engine concurrently
    let _ = tokio::join!(grpc_future, p2p_future);

    Ok(())
}

