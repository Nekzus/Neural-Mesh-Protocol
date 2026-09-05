// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// LIOP (Logic-Injection-on-Origin Protocol) gRPC Service Implementation

use tracing::{debug, error, info, warn};

use liop_core::v1::logic_mesh_server::LogicMesh;
use liop_core::v1::{IntentRequest, IntentResponse, LogicRequest, LogicResponse};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use pqcrypto_kyber::kyber768::*;
use pqcrypto_traits::kem::{Ciphertext, PublicKey, SecretKey as KemSecretKey, SharedSecret};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// We need the engine to run the logic
use crate::executor;

/// Maximum lifetime for a Kyber session before automatic expiration.
/// Configured via `config.toml` or defaults to 5 minutes.
struct SessionEntry {
    secret_key: Vec<u8>,
    created_at: Instant,
}

impl SessionEntry {
    fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

/// Rate-limiting window: max requests per agent_did within the window duration.
const RATE_LIMIT_MAX_REQUESTS: usize = 10;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

pub struct LiopService {
    engine: wasmtime::Engine,
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    session_ttl: Duration,
    #[allow(dead_code)]
    fuel_limit: u64,
    allowed_dir: String,
    /// Sliding window rate-limiter: agent_did -> timestamps of recent requests
    rate_limits: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
}

impl LiopService {
    pub fn new(
        engine: wasmtime::Engine,
        session_ttl: Duration,
        fuel_limit: u64,
        allowed_dir: String,
    ) -> Self {
        Self {
            engine,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            session_ttl,
            fuel_limit,
            allowed_dir,
            rate_limits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Checks if an agent_did has exceeded the rate limit.
    /// Returns Ok(()) if allowed, Err(Status) if rate-limited.
    fn check_rate_limit(&self, agent_did: &str) -> Result<(), Status> {
        let mut limits = self.rate_limits.lock().unwrap();
        let now = Instant::now();

        let window = limits.entry(agent_did.to_string()).or_default();

        // Purge timestamps outside the sliding window
        while window
            .front()
            .is_some_and(|t| now.duration_since(*t) > RATE_LIMIT_WINDOW)
        {
            window.pop_front();
        }

        if window.len() >= RATE_LIMIT_MAX_REQUESTS {
            warn!(
                agent_did = %agent_did,
                requests = window.len(),
                "Rate limit exceeded for agent"
            );
            return Err(Status::resource_exhausted(
                "Rate limit exceeded: max 10 handshakes per minute",
            ));
        }

        window.push_back(now);
        Ok(())
    }

    /// Purges expired sessions from the ephemeral store to prevent memory leaks
    /// from orphaned or abandoned handshakes.
    fn purge_expired_sessions(sessions: &mut HashMap<String, SessionEntry>, ttl: Duration) {
        let before = sessions.len();
        sessions.retain(|_, entry| !entry.is_expired(ttl));
        let purged = before - sessions.len();
        if purged > 0 {
            info!(purged = purged, "Session GC: purged expired session(s)");
        }
    }
}

#[tonic::async_trait]
impl LogicMesh for LiopService {
    async fn negotiate_intent(
        &self,
        request: Request<IntentRequest>,
    ) -> Result<Response<IntentResponse>, Status> {
        let req = request.into_inner();
        info!(agent_did = %req.agent_did, "Received LIOP Intent Negotiation");

        // Anti-DoS: enforce sliding window rate-limit per agent
        self.check_rate_limit(&req.agent_did)?;

        // Generate Post-Quantum Keypair (ML-KEM-768)
        let (pk, sk) = keypair();
        let session_token = format!("proto-session-{}", rand::random::<u32>());

        {
            let mut sessions = self.sessions.lock().unwrap();
            // Garbage collect expired sessions on every new handshake
            Self::purge_expired_sessions(&mut sessions, self.session_ttl);
            sessions.insert(
                session_token.clone(),
                SessionEntry {
                    secret_key: sk.as_bytes().to_vec(),
                    created_at: Instant::now(),
                },
            );
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
        info!(session = %req.session_token, "Executing Logic-on-Origin");

        let sk_bytes = {
            let mut sessions = self.sessions.lock().unwrap();
            match sessions.remove(&req.session_token) {
                Some(entry) if entry.is_expired(self.session_ttl) => {
                    warn!(
                        session = %req.session_token,
                        elapsed = ?entry.created_at.elapsed(),
                        "Session rejected: TTL expired"
                    );
                    None
                }
                Some(entry) => Some(entry.secret_key),
                None => None,
            }
        };

        let sk_b =
            sk_bytes.ok_or_else(|| Status::unauthenticated("Invalid or expired session token"))?;
        debug!(
            sk_len = sk_b.len(),
            sk_expected = pqcrypto_kyber::kyber768::secret_key_bytes(),
            ct_len = req.pqc_ciphertext.len(),
            ct_expected = pqcrypto_kyber::kyber768::ciphertext_bytes(),
            "PQC key sizes"
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

        info!("PQC: Decapsulating Shared Secret");
        let shared_secret = decapsulate(&ct, &sk);

        info!("AES-GCM: Decrypting Payload");
        let key = Key::<Aes256Gcm>::from_slice(shared_secret.as_bytes());
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&req.aes_nonce);

        let wasm_binary = cipher
            .decrypt(nonce, req.wasm_binary.as_ref())
            .map_err(|_| Status::unauthenticated("AES-GCM Decryption failed. Corrupt Payload"))?;

        let (tx, rx) = mpsc::channel(4);
        let engine_clone = self.engine.clone();
        let allowed_dir = self.allowed_dir.clone();

        // We spawn the Wasmtime execution on a blocking Tokio thread because
        // Wasm JIT execution is compute-intensive and could block the async reactor.
        tokio::task::spawn_blocking(move || {
            // Attempt to run the sandboxed WASM
            match executor::execute_sandboxed_logic(
                &engine_clone,
                &wasm_binary,
                &allowed_dir,
                tx.clone(),
            ) {
                Ok(_) => {
                    // Generate ZK Receipt using the ZK Execution Engine (Phase 7)
                    let zk_receipt_bytes =
                        match crate::zk::ZkExecutionEngine::prove_wasm_execution(&wasm_binary, &[])
                        {
                            Ok((_, receipt_bytes)) => receipt_bytes,
                            Err(e) => {
                                error!(error = %e, "ZK Proof generation failed");
                                vec![]
                            }
                        };

                    let res = LogicResponse {
                        semantic_evidence: "Execution Completed successfully.".to_string(),
                        cryptographic_proof: vec![0, 1, 2, 3],
                        zk_receipt: zk_receipt_bytes,
                        is_error: false,
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
                Err(e) => {
                    error!(error = %e, "Wasmtime Execution Error / Capability Violation");
                    let res = LogicResponse {
                        semantic_evidence: format!("Capability Violation: {}", e),
                        cryptographic_proof: vec![],
                        zk_receipt: vec![],
                        is_error: true,
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}
