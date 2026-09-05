// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

use std::error::Error;
use std::fmt;
use tracing::info;
use wasmparser::{Parser, Payload::*};

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
    info!("Guardian: Starting Zero-Time AST heuristic inspection");
    let parser = Parser::new(0);

    let mut import_count = 0;
    let mut func_count = 0;

    for payload in parser.parse_all(wasm_bytes) {
        match payload? {
            ImportSection(s) => {
                for import in s {
                    let import = import?;
                    // Strict Sandbox Validation: Only allow WASI preview 1 and native LIOP functions.
                    // Reject any custom or unexpected host imports.
                    if import.module != "wasi_snapshot_preview1" && import.module != "liop" {
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
                    return Err(Box::new(GuardianError(
                        "Payload exceeds structural limits (Potential AST Bomb)".into(),
                    )));
                }
            }
            _ => {}
        }
    }

    info!(
        imports = import_count,
        functions = func_count,
        "Guardian: AST clean"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_encoder::{
        CodeSection, EntityType, ExportKind, ExportSection, Function, FunctionSection,
        ImportSection, Instruction, MemorySection, MemoryType, Module, TypeSection, ValType,
    };

    /// Helper: builds a minimal valid WASM module with only WASI preview1 imports.
    fn make_valid_wasi_module() -> Vec<u8> {
        let mut module = Module::new();

        // Types: (i32,i32,i32,i32) -> i32 and () -> ()
        let mut types = TypeSection::new();
        types.ty().function(
            vec![ValType::I32, ValType::I32, ValType::I32, ValType::I32],
            vec![ValType::I32],
        );
        types.ty().function(vec![], vec![]);
        module.section(&types);

        // Import fd_write from wasi_snapshot_preview1
        let mut imports = ImportSection::new();
        imports.import(
            "wasi_snapshot_preview1",
            "fd_write",
            EntityType::Function(0),
        );
        module.section(&imports);

        // One local function (type 1: () -> ())
        let mut funcs = FunctionSection::new();
        funcs.function(1);
        module.section(&funcs);

        // Memory
        let mut memories = MemorySection::new();
        memories.memory(MemoryType {
            minimum: 1,
            maximum: None,
            memory64: false,
            shared: false,
            page_size_log2: None,
        });
        module.section(&memories);

        // Exports: _start + memory
        let mut exports = ExportSection::new();
        exports.export("_start", ExportKind::Func, 1); // index 1 = local func (after import)
        exports.export("memory", ExportKind::Memory, 0);
        module.section(&exports);

        // Code: empty _start body
        let mut code = CodeSection::new();
        let mut f = Function::new(vec![]);
        f.instruction(&Instruction::End);
        code.function(&f);
        module.section(&code);

        module.finish()
    }

    /// Helper: builds a WASM module that imports from a banned module ("env").
    fn make_banned_import_module() -> Vec<u8> {
        let mut module = Module::new();

        let mut types = TypeSection::new();
        types.ty().function(vec![], vec![]);
        module.section(&types);

        let mut imports = ImportSection::new();
        imports.import("env", "abort", EntityType::Function(0));
        module.section(&imports);

        module.finish()
    }

    /// Helper: builds a WASM module that imports from the "liop" namespace (allowed).
    fn make_liop_import_module() -> Vec<u8> {
        let mut module = Module::new();

        let mut types = TypeSection::new();
        types
            .ty()
            .function(vec![ValType::I32, ValType::I32], vec![]);
        module.section(&types);

        let mut imports = ImportSection::new();
        imports.import("liop", "push_event", EntityType::Function(0));
        module.section(&imports);

        module.finish()
    }

    #[test]
    fn accepts_valid_wasi_module() {
        let wasm = make_valid_wasi_module();
        let result = analyze_ast(&wasm);
        assert!(
            result.is_ok(),
            "Valid WASI module should pass Guardian AST check: {:?}",
            result.err()
        );
    }

    #[test]
    fn accepts_liop_namespace_imports() {
        let wasm = make_liop_import_module();
        let result = analyze_ast(&wasm);
        assert!(
            result.is_ok(),
            "LIOP namespace imports should be approved by Guardian: {:?}",
            result.err()
        );
    }

    #[test]
    fn rejects_banned_host_imports() {
        let wasm = make_banned_import_module();
        let result = analyze_ast(&wasm);
        assert!(result.is_err(), "Banned imports should be rejected");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Banned Host Import Detected"),
            "Error should indicate banned import, got: {err_msg}"
        );
    }

    #[test]
    fn rejects_invalid_wasm_bytes() {
        let garbage = vec![0xFF, 0xFE, 0xFD, 0xFC, 0x00];
        let result = analyze_ast(&garbage);
        assert!(result.is_err(), "Invalid WASM bytes should fail parsing");
    }

    #[test]
    fn accepts_empty_module_no_imports() {
        // Minimal valid WASM: just magic + version + empty
        let wasm = Module::new().finish();
        let result = analyze_ast(&wasm);
        assert!(result.is_ok(), "Module with no imports should pass");
    }
}
