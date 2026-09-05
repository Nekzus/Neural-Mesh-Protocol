// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

use anyhow::Result;
use clap::{Parser, Subcommand};
use liop_core::v1::logic_mesh_client::LogicMeshClient;
use liop_core::v1::IntentRequest;
use reqwest::Client;
use tracing::{error, info};

#[derive(Parser)]
#[command(name = "liop")]
#[command(about = "LIOP Developer CLI for zero-trust interactions", long_about = None)]
#[command(version = "0.1.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Checks the health of an LIOP node via HTTP
    Health {
        #[arg(short, long, default_value = "http://[::1]:50052")]
        target: String,
    },
    /// Negotiates a zero-trust intent handshake via gRPC
    Negotiate {
        #[arg(short, long, default_value = "http://[::1]:50051")]
        target: String,

        #[arg(short, long)]
        agent_did: Option<String>,

        #[arg(short, long)]
        capability: Option<String>,
    },
    /// Shows information about the CLI and the Logic-Injection-on-Origin Protocol
    Info,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();

    match &cli.command {
        Commands::Health { target } => {
            info!("Checking health of {}", target);
            let url = format!("{}/health", target);
            let client = Client::new();
            match client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    info!("Status: {}", status);
                    info!("Response: {}", text);
                }
                Err(e) => {
                    error!("Failed to connect to health endpoint: {}", e);
                }
            }
        }
        Commands::Negotiate {
            target,
            agent_did,
            capability,
        } => {
            info!("Negotiating zero-trust intent with {}", target);
            let mut client = match LogicMeshClient::connect(target.clone()).await {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to connect via gRPC: {}", e);
                    return Ok(());
                }
            };

            let req = IntentRequest {
                agent_did: agent_did.clone().unwrap_or_else(|| "did:liop:cli-agent".to_string()),
                capability_hash: capability
                    .clone()
                    .unwrap_or_else(|| "debug-capability-hash".to_string()),
                proof_of_intent: b"cli-proof-dummy".to_vec(),
            };

            info!("Sending IntentRequest -> {}", req.agent_did);
            match client.negotiate_intent(tonic::Request::new(req)).await {
                Ok(response) => {
                    let inner = response.into_inner();
                    info!("IntentResponse received:");
                    if inner.accepted {
                        info!("  [SUCCESS] Accepted by host");
                        info!("  Session Token: {}", inner.session_token);
                        info!("  Kyber PK length: {} bytes", inner.kyber_public_key.len());
                    } else {
                        error!("  [REJECTED] by host");
                        error!("  Reason: {}", inner.error_message);
                    }
                }
                Err(status) => {
                    error!("gRPC request failed: {}", status);
                }
            }
        }
        Commands::Info => {
            println!("LIOP CLI - Logic-Injection-on-Origin Protocol Developer Tool");
            println!("Version: 0.1.0");
            println!("Features: zero-trust, post-quantum cryptography, multiplexing");
            println!("Status: Alpha (Experimental)");
        }
    }

    Ok(())
}
