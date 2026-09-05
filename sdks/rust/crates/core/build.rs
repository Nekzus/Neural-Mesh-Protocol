// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../../../../protocol/proto/liop_core.proto");

    // Inject the vendored protoc compiler path to environment
    // to bypass the need of external 'protoc' installed on the OS.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap());

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(
            &["../../../../protocol/proto/liop_core.proto"],
            &["../../../../protocol/proto"],
        )?;
    Ok(())
}
