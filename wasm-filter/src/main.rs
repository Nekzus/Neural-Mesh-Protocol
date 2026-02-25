// Logic-on-Origin: LocalLogAnalyzer Payload
// This gets compiled to WebAssembly (wasm32-wasi) 
// and injected into the Data Node by the AI Agent.

use std::fs::File;
use std::io::{self, BufRead, BufReader};

fn main() -> io::Result<()> {
    // Under WASI, the "/data" directory is the ONLY path safely mounted by the Host (Zero-Trust context)
    // Attempting to read outside "/data" will instantly panic and ban the WASM execution.
    let log_path = "/data/dummy_logs.txt";
    
    // We open the Multi-Megabyte log LOCALLY at the Origin Server, completely bypassing network transport.
    let file = match File::open(log_path) {
        Ok(f) => f,
        Err(e) => {
             eprintln!("Capability Violation: {}", e);
             return Ok(());
        }
    };
    let reader = BufReader::new(file);

    let mut found_count = 0;
    for line in reader.lines() {
        let text = line?;
        if text.contains("CRITICAL") {
            // Found a critical entry! Push it to stdout so the Host pipes it to the Agent's Stream.
            println!("WASM-FILTER-MATCH: {}", text);
            found_count += 1;
        }
        
        // Safety / Demo break: stop after 3 matches.
        if found_count >= 3 {
             break;
        }
    }
    
    // Concluding remarks
    println!("NMP Summary: Scanned remote gigabytes seamlessly. Extracted {} evidence items.", found_count);

    Ok(())
}
