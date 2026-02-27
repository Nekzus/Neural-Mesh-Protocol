// Neural Mesh Protocol - Server Node (Data Host)
// This node holds the data and provides a Zero-Trust Wasmtime sandbox for execution.

use futures::StreamExt;
use libp2p::kad::store::RecordStore;
use std::error::Error;

pub mod executor;
pub mod grpc;
mod guardian; // Added guardian module
pub mod p2p;
mod tee;
pub mod zk;

use tee::{AwsNitroEnclaveStub, EnclaveProvider};

use grpc::NmpService;
use nmp_core::v1::neural_mesh_server::NeuralMeshServer;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("NMP Server Node - Initiating Genesis Boot Sequence...");

    // Phase 4: Hardware Enclave (TEE) Bootstrapping Stub
    let enclave = AwsNitroEnclaveStub;
    enclave.attest_and_boot()?;
    let _report = enclave.generate_attestation_report(b"nmp-nonce-1234")?;

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

    // 5. Publish Capabilities to DHT (Zero ListTools Routing)
    // In NMP, the server unilaterally pushes its schemas to the decentralized table.
    // The Agent (LLM) reads this from the network RAM cache without pinging the server.
    println!("[-] Publishing Tool Schemas to Kademlia DHT...");
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

    let record_key = libp2p::kad::RecordKey::new(&"nmp:capabilities:LocalLogAnalyzer");
    let record = libp2p::kad::Record {
        key: record_key,
        value: capabilities_json.as_bytes().to_vec(),
        publisher: None,
        expires: None,
    };

    // For local prototype testing we store it directly. In a live mesh, we use `put_record`.
    let _ = swarm.behaviour_mut().kademlia.store_mut().put(record);
    println!("[-] Capabilities cached successfully on the P2P Mesh.");

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
