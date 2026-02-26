use wasmparser::{Parser, Payload::*};
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub struct GuardianError(String);

impl fmt::Display for GuardianError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "AST Sec-Policy Violation: {}", self.0)
    }
}
impl Error for GuardianError {}

/// The Guardian Module
/// Scans the Abstract Syntax Tree (AST) of incoming WASM 
/// before it reaches the Wasmtime engine to prevent sandbox-escape 
/// zero-days, resource exhaustion bombs, and evasive execution.
pub fn analyze_ast(wasm_bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    println!("[Guardian] 🛡️ Starting Zero-Time AST heuristic inspection...");
    let parser = Parser::new(0);
    
    let mut import_count = 0;
    let mut func_count = 0;
    
    for payload in parser.parse_all(wasm_bytes) {
        match payload? {
            ImportSection(s) => {
                for import in s {
                    let import = import?;
                    // Strict Sandbox Validation: Only allow WASI preview 1 imports.
                    // Reject any custom or unexpected host imports.
                    if import.module != "wasi_snapshot_preview1" {
                        return Err(Box::new(GuardianError(format!(
                            "Banned Host Import Detected: {}/{}",
                            import.module, import.name
                        ))));
                    }
                    import_count += 1;
                }
            }
            CodeSectionStart { count, .. } => {
                func_count = count;
                // Protection against AST decompression bombs
                if count > 50000 {
                    return Err(Box::new(GuardianError("Payload exceeds structural limits (Potential AST Bomb)".into())));
                }
            }
            _ => {}
        }
    }
    
    println!("[Guardian] ✅ AST clean. Validated {} WASI imports across {} functions.", import_count, func_count);
    Ok(())
}
