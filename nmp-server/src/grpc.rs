// NMP gRPC Service Implementation

use nmp_core::v1::neural_mesh_server::NeuralMesh;
use nmp_core::v1::{IntentRequest, IntentResponse, LogicRequest, LogicResponse};
use tonic::{Request, Response, Status};
use tokio_stream::wrappers::ReceiverStream;
use tokio::sync::mpsc;

// We need the engine to run the logic
use crate::executor;

pub struct NmpService {
    engine: wasmtime::Engine,
}

impl NmpService {
    pub fn new(engine: wasmtime::Engine) -> Self {
        Self { engine }
    }
}

#[tonic::async_trait]
impl NeuralMesh for NmpService {
    async fn negotiate_intent(
        &self,
        request: Request<IntentRequest>,
    ) -> Result<Response<IntentResponse>, Status> {
        let req = request.into_inner();
        println!("[-] Received NMP Intent Negotiation from DID: {}", req.agent_did);

        // Here we would validate the cryptographic proof.
        // For the prototype, we assume valid intent and grant an ephemeral session.
        let response = IntentResponse {
            accepted: true,
            session_token: "proto-session-1234".to_string(),
            error_message: String::new(),
        };

        Ok(Response::new(response))
    }

    type ExecuteLogicStream = ReceiverStream<Result<LogicResponse, Status>>;

    async fn execute_logic(
        &self,
        request: Request<LogicRequest>,
    ) -> Result<Response<Self::ExecuteLogicStream>, Status> {
        let req = request.into_inner();
        println!("[-] Executing Logic-on-Origin for session: {}", req.session_token);

        let (tx, rx) = mpsc::channel(4);
        let engine_clone = self.engine.clone();
        
        // We spawn the Wasmtime execution on a blocking Tokio thread because 
        // Wasm JIT execution is compute-intensive and could block the async reactor.
        tokio::task::spawn_blocking(move || {
            let allowed_dir = "."; // For testing, allow reading the current dir

            // Attempt to run the sandboxed WASM
            match executor::execute_sandboxed_logic(&engine_clone, &req.wasm_binary, allowed_dir) {
                Ok(_) => {
                    // Send success proof
                    let res = LogicResponse {
                        semantic_evidence: "Execution Completed successfully.".to_string(),
                        cryptographic_proof: vec![0, 1, 2, 3], // Dummy hash
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
                Err(e) => {
                    println!("[!] Wasmtime Execution Error / Capability Violation: {}", e);
                    let res = LogicResponse {
                        semantic_evidence: format!("Capability Violation: {}", e),
                        cryptographic_proof: vec![],
                    };
                    let _ = tx.blocking_send(Ok(res));
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}
