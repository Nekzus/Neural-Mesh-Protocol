/**
 * TypeScript interfaces reflecting nmp_core.proto (NMP v1)
 * Optimized for logic-on-origin and high-performance serialization.
 */

export interface IntentRequest {
    agent_did: string;
    capability_hash: string;
    proof_of_intent: Uint8Array;
}

export interface IntentResponse {
    accepted: boolean;
    session_token: string;
    error_message: string;
    kyber_public_key: Uint8Array;
}

export interface LogicRequest {
    session_token: string;
    wasm_binary: Uint8Array;
    inputs: Record<string, Uint8Array>;
    pqc_ciphertext: Uint8Array;
    aes_nonce: Uint8Array;
}

export interface LogicResponse {
    semantic_evidence: string;
    cryptographic_proof: Uint8Array;
    zk_receipt: Uint8Array;
    is_error: boolean;
}
