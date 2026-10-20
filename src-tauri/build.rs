fn main() {
    if std::env::var("PROFILE").as_deref() == Ok("release")
        && tauri_build::is_dev()
    {
        panic!("Release builds must embed frontend assets. Use npm run tauri -- build --no-bundle, or cargo build --release --features custom-protocol after building the frontend.");
    }
    tauri_build::build()
}
