fn main() {
    // Only rerun the build script and trigger recompilation if files in src/ change.
    // This ignores changes to app_data/ai_config.yml to prevent infinite recompilation loops.
    println!("cargo:rerun-if-changed=src");
}
