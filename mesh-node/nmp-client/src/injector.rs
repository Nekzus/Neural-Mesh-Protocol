// Client Logic-on-Origin Injector

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use nmp_core::v1::neural_mesh_client::NeuralMeshClient;
use nmp_core::v1::{IntentRequest, LogicRequest};
use pqcrypto_kyber::kyber768::*;
use pqcrypto_traits::kem::{Ciphertext, PublicKey, SharedSecret};
use std::error::Error;
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

    println!(
        "[-] Intent Accepted! Ephemeral Session Token: {}",
        intent_res.session_token
    );

    // 2. Read the WASM Filter from disk
    println!("[-] Loading Local Logic-on-Origin module: {}", wasm_path);
    let mut f = std::fs::File::open(wasm_path)?;
    let mut wasm_buffer = Vec::new();
    f.read_to_end(&mut wasm_buffer)?;

    // 3. PQC KEM & Symmetric Encryption
    println!("[-] PQC: Encapsulating AES Key using Server's Kyber Public Key...");
    let pk = pqcrypto_kyber::kyber768::PublicKey::from_bytes(&intent_res.kyber_public_key)
        .map_err(|_| "Failed to parse Kyber Public Key")?;
    let (ss, ct) = encapsulate(&pk);

    println!("[-] AES-GCM: Encrypting WASM payload...");
    let key = Key::<Aes256Gcm>::from_slice(ss.as_bytes());
    let cipher = Aes256Gcm::new(key);

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted_wasm = cipher
        .encrypt(nonce, wasm_buffer.as_ref())
        .map_err(|e| format!("AES-GCM encryption failed: {:?}", e))?;

    // 4. Inject Logic
    println!(
        "[-] Deploying Encrypted Logic ({} bytes) over the wire...",
        encrypted_wasm.len()
    );
    let logic_req = tonic::Request::new(LogicRequest {
        session_token: intent_res.session_token,
        wasm_binary: encrypted_wasm,
        inputs: std::collections::HashMap::new(),
        pqc_ciphertext: ct.as_bytes().to_vec(),
        aes_nonce: nonce_bytes.to_vec(),
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
