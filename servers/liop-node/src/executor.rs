// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

// Zero-Trust Execution Sandbox (Logic-on-Origin)
// Powered by Wasmtime + WASI

use std::error::Error;
use tracing::{info, warn};
use wasmtime::{Config, Engine, Linker, Module, Store};
use wasmtime_wasi::preview1::WasiP1Ctx;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtxBuilder};

use liop_core::v1::LogicResponse;
use tokio::sync::mpsc::Sender;

/// Holds the execution state per Agent request.
/// Implements wasmtime's host state pattern for WASI P1 modules.
pub struct AgentExecutionState {
    pub wasi: WasiP1Ctx,
    pub tx: Sender<Result<LogicResponse, tonic::Status>>,
}

pub fn create_wasi_engine() -> Result<Engine, Box<dyn Error>> {
    info!("Initializing Zero-Trust Wasmtime Engine");
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    // Optimization for Logic-on-Origin speed
    config.cranelift_opt_level(wasmtime::OptLevel::SpeedAndSize);

    // GUARDIAN: Enable deterministic computational fuel limit
    config.consume_fuel(true);

    let engine = Engine::new(&config)?;
    Ok(engine)
}

/// Executes a LogicRequest's WASM binary within a strict Sandbox.
pub fn execute_sandboxed_logic(
    engine: &Engine,
    wasm_bytes: &[u8],
    allowed_dir: &str,
    tx: Sender<Result<LogicResponse, tonic::Status>>,
) -> Result<(), Box<dyn Error>> {
    // 1. GUARDIAN MODULE: Zero-Time AST Structural Scanning
    // Rejects malicious structure before the JIT Compiler even sees it.
    crate::guardian::analyze_ast(wasm_bytes)?;

    let mut linker = Linker::new(engine);

    // Link WASI P1 (wasi_snapshot_preview1) syscalls into the linker
    wasmtime_wasi::preview1::add_to_linker_sync(&mut linker, |s: &mut AgentExecutionState| {
        &mut s.wasi
    })?;

    // ZERO-TRUST CAPABILITY MODEL
    // By default, the injected WASM logic has NO network access, NO env vars, and NO filesystem.
    // We explicitly grant ONLY read-access to `allowed_dir`.
    let wasi = WasiCtxBuilder::new()
        .inherit_stdio() // For prototype, we pipe stdout back
        .preopened_dir(allowed_dir, "/data", DirPerms::READ, FilePerms::READ)?
        .build_p1();

    let mut store = Store::new(engine, AgentExecutionState { wasi, tx });

    // GUARDIAN: Assign Computational Fuel Limit
    store.set_fuel(500_000_000)?;

    // PUSH EVENT HOST FUNCTION
    linker.func_wrap(
        "liop",
        "push_event",
        |mut caller: wasmtime::Caller<'_, AgentExecutionState>,
         ptr: u32,
         len: u32|
         -> anyhow::Result<()> {
            let mem = match caller.get_export("memory") {
                Some(wasmtime::Extern::Memory(m)) => m,
                _ => return Err(anyhow::anyhow!("failed to find host memory")),
            };
            let data = mem
                .data(&caller)
                .get(ptr as usize..(ptr + len) as usize)
                .ok_or_else(|| anyhow::anyhow!("OOB memory access"))?;

            let msg = std::str::from_utf8(data).unwrap_or("BAD_UTF8").to_string();

            let res = LogicResponse {
                semantic_evidence: format!("[WATCHDOG PUSH ALERT]: {}", msg),
                cryptographic_proof: vec![],
                zk_receipt: vec![],
                is_error: false,
            };
            let _ = caller.data().tx.blocking_send(Ok(res));
            Ok(())
        },
    )?;

    info!("Compiling incoming LIOP Logic Module");
    let module = Module::new(engine, wasm_bytes)?;

    info!("Linking Capabilities");
    let instance = linker.instantiate(&mut store, &module)?;

    info!("Triggering Logic-on-Origin execution");
    let start_func = instance.get_typed_func::<(), ()>(&mut store, "_start")?;

    match start_func.call(&mut store, ()) {
        Ok(_) => Ok(()),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("all fuel consumed") {
                warn!("GUARDIAN ACTIVE: WASM execution halted due to CPU Fuel Exhaustion");
                let res = LogicResponse {
                    semantic_evidence:
                        "[AST Sandbox Halt]: Execution Exceeded Computational Fuel Threshold"
                            .to_string(),
                    cryptographic_proof: vec![],
                    zk_receipt: vec![],
                    is_error: true,
                };
                let _ = store.data().tx.blocking_send(Ok(res));
                Ok(())
            } else {
                Err(e.into())
            }
        }
    }
}
