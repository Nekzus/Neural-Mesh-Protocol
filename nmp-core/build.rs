fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=proto/nmp_core.proto");
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(&["proto/nmp_core.proto"], &["proto"])?;
    Ok(())
}
