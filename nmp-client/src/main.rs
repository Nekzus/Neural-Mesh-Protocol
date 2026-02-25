// Neural Mesh Protocol - Client Node (AI Agent Logic Injector)
// This node searches for the target capability and pushes a WASM filter rather than pulling data.

use std::error::Error;
use futures::StreamExt;

pub mod p2p;
pub mod injector;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("NMP AI Agent Client - Booting Logic-on-Origin injection engine...");
    
    // Initialize Libp2p generic mesh presence (Kademlia/Noise)
    let mut swarm = p2p::build_client_swarm()?;
    
    // Listen on local port to participate in the mesh DHT
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    println!("Entering Agent Mesh Network Loop...");
    
    // Start P2P Mesh background task
    let p2p_future = async move {
        loop {
            tokio::select! {
                 event = swarm.select_next_some() => {
                     match event {
                         libp2p::swarm::SwarmEvent::NewListenAddr { address, .. } => {
                             println!("[-] Agent connected to Mesh on: {}", address);
                         }
                         _ => {}
                     }
                 }
            }
        }
    };
    
    // Execute NMP AI Tool call against Data Node
    // In a real topology this triggers dynamically on-demand from LLM.
    let injection_future = async move {
        // Wait briefly for server to boot up
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // Execute targeting the demo target
        let target_ip = "[::1]:50051"; // Default dev NMP port
        let wasm_file = "target/wasm32-wasip1/release/wasm-filter.wasm";
        
        if let Err(e) = injector::inject_logic(target_ip, wasm_file).await {
            eprintln!("[!] Failed to inject WASM Logic: {}", e);
        }
    };

    // Run both concurrently
    let _ = tokio::join!(p2p_future, injection_future);

    Ok(())
}
