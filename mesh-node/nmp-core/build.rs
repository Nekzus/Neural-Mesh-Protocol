fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=proto/nmp_core.proto");
    
    // Inject the vendored protoc compiler path to environment 
    // to bypass the need of external 'protoc' installed on the OS.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap());

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(&["proto/nmp_core.proto"], &["proto"])?;
    Ok(())
}

