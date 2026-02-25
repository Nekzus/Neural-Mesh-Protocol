// Neural Mesh Protocol - Logic-on-Origin Filter
// This code is compiled to wasm32-wasi and transmitted over the wire.
// It executes ON the Data Node (Server), preventing gigabytes of JSON-RPC transfers.

use std::fs::File;
use std::io::{self, BufRead};

fn main() {
    println!("NMP Logic-on-Origin: WASM Filter initialized.");
    
    // The server pre-opened this descriptor via WASI and granted us scoped capability.
    // We are looking for the word "CRITICAL"
    let target_word = "CRITICAL";

    // In a real NMP mesh, the filename or file descriptor is passed via WASI env vars
    // For this prototype, we'll try to read a shared map or a standard file name.
    let file = match File::open("local_data.log") {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Capability Violation or File Not Found: {}", e);
            return;
        }
    };

    let reader = io::BufReader::new(file);

    for line in reader.lines() {
        if let Ok(content) = line {
            if content.contains(target_word) {
                // By printing to stdout, we actually pipe back to the Wasmtime host
                // which multiplexes this back to the AI Agent over Tonic gRPC.
                println!("MATCHED: {}", content);
            }
        }
    }
}
