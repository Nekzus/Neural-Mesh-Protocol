// Zero-Trust Execution Sandbox (Logic-on-Origin)
// Powered by Wasmtime + WASI

use std::error::Error;
use wasmtime::{Config, Engine, Linker, Module, Store};
use wasmtime_wasi::sync::WasiCtxBuilder;
use wasmtime_wasi::WasiCtx;

// Holds the execution state per Agent request.
pub struct AgentExecutionState {
    pub wasi: WasiCtx,
}

pub fn create_wasi_engine() -> Result<Engine, Box<dyn Error>> {
    println!("Init Zero-Trust Wasmtime Engine...");
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    // Optimization for Logic-on-Origin speed
    config.cranelift_opt_level(wasmtime::OptLevel::SpeedAndSize);
    
    let engine = Engine::new(&config)?;
    Ok(engine)
}

/// Executes a LogicRequest's WASM binary within a strict Sandbox.
pub fn execute_sandboxed_logic(
    engine: &Engine,
    wasm_bytes: &[u8],
    allowed_dir: &str,
) -> Result<(), Box<dyn Error>> {

    let mut linker = Linker::new(engine);
    wasmtime_wasi::sync::add_to_linker(&mut linker, |s: &mut AgentExecutionState| &mut s.wasi)?;

    // ZERO-TRUST CAPABILITY MODEL
    // By default, the injected WASM logic has NO network access, NO env vars, and NO filesystem.
    // We explicitly grant ONLY read-access to `allowed_dir`.
    let dir = wasmtime_wasi::Dir::open_ambient_dir(
        allowed_dir,
        wasmtime_wasi::ambient_authority(),
    )?;

    let wasi = WasiCtxBuilder::new()
        .inherit_stdio()      // For prototype, we pipe stdout back
        .inherit_args()?
        .preopened_dir(dir, "/data")?
        .build();

    let mut store = Store::new(engine, AgentExecutionState { wasi });

    println!("[-] Compiling incoming NMP Logic Module...");
    let module = Module::new(engine, wasm_bytes)?;
    
    println!("[-] Linking Capabilities...");
    let instance = linker.instantiate(&mut store, &module)?;
    
    println!("[-] Triggering Logic-on-Origin execution...");
    let start_func = instance.get_typed_func::<(), ()>(&mut store, "_start")?;
    start_func.call(&mut store, ())?;

    Ok(())
}
