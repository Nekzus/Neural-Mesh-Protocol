// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// LIOP Server Configuration Module
// Loads configuration from TOML file or environment variables.

use serde::Deserialize;
use std::error::Error;
use std::path::Path;
use std::time::Duration;
use tracing::{info, warn};

/// Root configuration structure parsed from `config.toml`.
#[derive(Deserialize, Debug, Clone)]
#[derive(Default)]
pub struct LiopConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub sandbox: SandboxConfig,
    #[serde(default)]
    pub session: SessionConfig,
    #[serde(default)]
    pub security: SecurityConfig,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ServerConfig {
    #[serde(default = "default_grpc_addr")]
    pub grpc_addr: String,
    #[serde(default = "default_p2p_listen")]
    pub p2p_listen: String,
    #[serde(default = "default_p2p_quic_listen")]
    pub p2p_quic_listen: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SandboxConfig {
    #[serde(default = "default_fuel_limit")]
    pub fuel_limit: u64,
    #[serde(default = "default_allowed_dir")]
    pub allowed_dir: String,
    #[allow(dead_code)]
    #[serde(default = "default_max_functions")]
    pub max_functions: u32,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SessionConfig {
    #[serde(default = "default_ttl_seconds")]
    pub ttl_seconds: u64,
    #[allow(dead_code)]
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: usize,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SecurityConfig {
    #[serde(default)]
    pub tls_enabled: bool,
    #[allow(dead_code)]
    #[serde(default = "default_cert_path")]
    pub cert_path: String,
    #[allow(dead_code)]
    #[serde(default = "default_key_path")]
    pub key_path: String,
}

// Default value functions
fn default_grpc_addr() -> String {
    "[::1]:50051".to_string()
}
fn default_p2p_listen() -> String {
    "/ip4/0.0.0.0/tcp/0".to_string()
}
fn default_p2p_quic_listen() -> String {
    "/ip4/0.0.0.0/udp/0/quic-v1".to_string()
}
fn default_fuel_limit() -> u64 {
    500_000_000
}
fn default_allowed_dir() -> String {
    ".".to_string()
}
fn default_max_functions() -> u32 {
    50_000
}
fn default_ttl_seconds() -> u64 {
    300
}
fn default_max_concurrent() -> usize {
    1000
}
fn default_cert_path() -> String {
    "certs/server.crt".to_string()
}
fn default_key_path() -> String {
    "certs/server.key".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            grpc_addr: default_grpc_addr(),
            p2p_listen: default_p2p_listen(),
            p2p_quic_listen: default_p2p_quic_listen(),
        }
    }
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            fuel_limit: default_fuel_limit(),
            allowed_dir: default_allowed_dir(),
            max_functions: default_max_functions(),
        }
    }
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            ttl_seconds: default_ttl_seconds(),
            max_concurrent: default_max_concurrent(),
        }
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            tls_enabled: false,
            cert_path: default_cert_path(),
            key_path: default_key_path(),
        }
    }
}


impl SessionConfig {
    /// Returns the TTL as a `Duration` for use with `Instant` comparisons.
    pub fn ttl_duration(&self) -> Duration {
        Duration::from_secs(self.ttl_seconds)
    }
}

impl LiopConfig {
    /// Loads configuration from the path specified by `LIOP_CONFIG` env var,
    /// or falls back to `config.toml` in the working directory.
    /// If no file exists, returns the built-in defaults.
    pub fn load() -> Result<Self, Box<dyn Error>> {
        let config_path = std::env::var("LIOP_CONFIG").unwrap_or_else(|_| "config.toml".to_string());

        let path = Path::new(&config_path);
        if path.exists() {
            let content = std::fs::read_to_string(path)?;
            let config: LiopConfig = toml::from_str(&content)?;
            info!(path = %config_path, "Configuration loaded from file");
            Ok(config)
        } else {
            warn!(path = %config_path, "Config file not found, using built-in defaults");
            Ok(LiopConfig::default())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        let config = LiopConfig::default();
        assert_eq!(config.server.grpc_addr, "[::1]:50051");
        assert_eq!(config.sandbox.fuel_limit, 500_000_000);
        assert_eq!(config.session.ttl_seconds, 300);
        assert!(!config.security.tls_enabled);
    }

    #[test]
    fn parses_toml_string() {
        let toml_str = r#"
            [server]
            grpc_addr = "[::1]:9090"

            [sandbox]
            fuel_limit = 1_000_000

            [session]
            ttl_seconds = 60
        "#;
        let config: LiopConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.server.grpc_addr, "[::1]:9090");
        assert_eq!(config.sandbox.fuel_limit, 1_000_000);
        assert_eq!(config.session.ttl_seconds, 60);
        // Unspecified fields use defaults
        assert_eq!(config.server.p2p_listen, "/ip4/0.0.0.0/tcp/0");
        assert_eq!(config.server.p2p_quic_listen, "/ip4/0.0.0.0/udp/0/quic-v1");
    }

    #[test]
    fn ttl_duration_converts_correctly() {
        let session = SessionConfig {
            ttl_seconds: 120,
            ..Default::default()
        };
        assert_eq!(session.ttl_duration(), Duration::from_secs(120));
    }
}
