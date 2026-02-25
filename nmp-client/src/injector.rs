// Client Logic-on-Origin Injector

use nmp_core::v1::neural_mesh_client::NeuralMeshClient;
use nmp_core::v1::{IntentRequest, LogicRequest};
use std::error::Error;
use std::fs::File;
use std::io::Read;

pub async fn inject_logic(target_ip: &str, wasm_path: &str) -> Result<(), Box<dyn Error>> {
    println!("[-] Connecting to NMP Data Node at {}", target_ip);
    
    // In a real scenario, this IP is resolved from the DHT via Kademlia
    let mut client = NeuralMeshClient::connect(format!("http://{}", target_ip)).await?;

    // 1. Intent Negotiation (Zero-Trust Handshake)
    println!("[-] Sending Intent Negotiation (Proof of Capability)...");
    let intent_req = tonic::Request::new(IntentRequest {
        agent_did: "spiffe://nmp.ai/agent/alpha-1".to_string(),
        capability_hash: "hash_filter_log".to_string(),
        proof_of_intent: vec![], // Signed token
    });

    let intent_res = client.negotiate_intent(intent_req).await?.into_inner();
    
    if !intent_res.accepted {
        eprintln!("[!] Host rejected Intent: {}", intent_res.error_message);
        return Ok(());
    }
    
    println!("[-] Intent Accepted! Ephemeral Session Token: {}", intent_res.session_token);

    // 2. Read the WASM Filter from disk
    println!("[-] Loading Local Logic-on-Origin module: {}", wasm_path);
    let mut f = File::open(wasm_path)?;
    let mut wasm_buffer = Vec::new();
    f.read_to_end(&mut wasm_buffer)?;

    // 3. Inject Logic
    println!("[-] Deploying Logic ({} bytes) over the wire...", wasm_buffer.len());
    let logic_req = tonic::Request::new(LogicRequest {
        session_token: intent_res.session_token,
        wasm_binary: wasm_buffer,
        // Optional capability configs inside the sandbox
        inputs: std::collections::HashMap::new(),
    });

    let mut response_stream = client.execute_logic(logic_req).await?.into_inner();

    println!("\n=========== LOGIC OUTPUT STREAM ===========");
    // 4. Stream back the results
    while let Some(msg) = response_stream.message().await? {
        println!("Received Evidence >> {}", msg.semantic_evidence);
    }
    println!("===========================================\n");

    Ok(())
}
