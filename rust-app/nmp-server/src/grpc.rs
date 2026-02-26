// NMP gRPC Service Implementation

use nmp_core::v1::neural_mesh_server::NeuralMesh;
use nmp_core::v1::{IntentRequest, IntentResponse, LogicRequest, LogicResponse};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use pqcrypto_kyber::kyber768::*;
use pqcrypto_traits::kem::{Ciphertext, PublicKey, SecretKey as KemSecretKey, SharedSecret};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// We need the engine to run the logic
use crate::executor;

pub struct NmpService {
    engine: wasmtime::Engine,
    // Ephemeral store: session_token -> Kyber SecretKey bytes
    sessions: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl NmpService {
    pub fn new(engine: wasmtime::Engine) -> Self {
        Self {
            engine,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tonic::async_trait]
impl NeuralMesh for NmpService {
    async fn negotiate_intent(
        &self,
        request: Request<IntentRequest>,
    ) -> Result<Response<IntentResponse>, Status> {
        let req = request.into_inner();
        println!(
            "[-] Received NMP Intent Negotiation from DID: {}",
            req.agent_did
        );

        // Here we would validate the cryptographic proof.
        // Generate Post-Quantum Keypair (ML-KEM-768)
        let (pk, sk) = keypair();
        let session_token = format!("proto-session-{}", rand::random::<u32>());

        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(session_token.clone(), sk.as_bytes().to_vec());
        }

        let response = IntentResponse {
            accepted: true,
            session_token,
            error_message: String::new(),
            kyber_public_key: pk.as_bytes().to_vec(),
        };

        Ok(Response::new(response))
    }

    type ExecuteLogicStream = ReceiverStream<Result<LogicResponse, Status>>;

    async fn execute_logic(
        &self,
        request: Request<LogicRequest>,
    ) -> Result<Response<Self::ExecuteLogicStream>, Status> {
        let req = request.into_inner();
        println!(
            "[-] Executing Logic-on-Origin for session: {}",
            req.session_token
        );

        let sk_bytes = {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.remove(&req.session_token)
        };

        let sk_b =
            sk_bytes.ok_or_else(|| Status::unauthenticated("Invalid or expired session token"))?;
        println!(
            "[-] Debug: SK bytes length = {}, Expected: {}",
            sk_b.len(),
            pqcrypto_kyber::kyber768::secret_key_bytes()
        );
        println!(
            "[-] Debug: CT bytes length = {}, Expected: {}",
            req.pqc_ciphertext.len(),
            pqcrypto_kyber::kyber768::ciphertext_bytes()
        );

        let sk = pqcrypto_kyber::kyber768::SecretKey::from_bytes(&sk_b)
            .map_err(|_| Status::internal(format!("Kyber SK Parse Error (len: {})", sk_b.len())))?;
        let ct = pqcrypto_kyber::kyber768::Ciphertext::from_bytes(&req.pqc_ciphertext).map_err(
            |_| {
                Status::internal(format!(
                    "Kyber CT Parse Error (len: {})",
                    req.pqc_ciphertext.len()
                ))
            },
        )?;

        println!("[-] PQC: Decapsulating Shared Secret...");
        let shared_secret = decapsulate(&ct, &sk);

        println!("[-] AES-GCM: Decrypting Payload...");
        let key = Key::<Aes256Gcm>::from_slice(shared_secret.as_bytes());
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&req.aes_nonce);

        let wasm_binary = cipher
            .decrypt(nonce, req.wasm_binary.as_ref())
            .map_err(|_| Status::unauthenticated("AES-GCM Decryption failed. Corrupt Payload"))?;

        let (tx, rx) = mpsc::channel(4);
        let engine_clone = self.engine.clone();

        // We spawn the Wasmtime execution on a blocking Tokio thread because
        // Wasm JIT execution is compute-intensive and could block the async reactor.
        tokio::task::spawn_blocking(move || {
            let allowed_dir = "."; // For testing, allow reading the current dir

            // Attempt to run the sandboxed WASM
            match executor::execute_sandboxed_logic(
                &engine_clone,
                &wasm_binary,
                allowed_dir,
                tx.clone(),
            ) {
                Ok(_) => {
                    // Send success proof
                    let res = LogicResponse {
                        semantic_evidence: "Execution Completed successfully.".to_string(),
                        cryptographic_proof: vec![0, 1, 2, 3], // Dummy hash
                        zk_receipt: vec![0xDE, 0xAD, 0xBE, 0xEF], // Stub for risc0 zkVM receipt
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
                Err(e) => {
                    println!("[!] Wasmtime Execution Error / Capability Violation: {}", e);
                    let res = LogicResponse {
                        semantic_evidence: format!("Capability Violation: {}", e),
                        cryptographic_proof: vec![],
                        zk_receipt: vec![],
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}
