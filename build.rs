fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let source = ".runtime/cloudflared/win32/cloudflared.exe";
        println!("cargo:rerun-if-changed={source}");
        let mut input =
            std::fs::File::open(source).expect("prepare the Windows cloudflared helper first");
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let packed = std::fs::File::create(out.join("cloudflared.gz")).unwrap();
        let mut encoder = flate2::write::GzEncoder::new(packed, flate2::Compression::default());
        std::io::copy(&mut input, &mut encoder).unwrap();
        encoder.finish().unwrap();
    }
    tauri_build::build()
}
