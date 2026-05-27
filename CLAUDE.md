# Alouette-Server Project Guidelines

This file serves as the core instruction guide for the AI Agent Harness within this workspace.

## Build and Run Commands
- **Dev (Frontend & Backend):** `npx --prefix ui tauri dev`
- **Build Production:** `npm run tauri build` (run from the `tauri_app` or specific package depending on workspace scope)
- **Rust Core Build:** `cargo build --manifest-path core_engine/Cargo.toml`
- **Rust Core Test:** `cargo test --manifest-path core_engine/Cargo.toml`

## Project Architecture
- `core_engine/`: Core system management engine, sandboxing tier 1+2, and process/agent harness.
- `tauri_app/`: Tauri desktop application shell.
  - `src-tauri/`: Rust backend bridging desktop window APIs and commands.
  - `ui/`: React + TypeScript frontend panel manager.

## Coding Style & Guidelines
- **Rust Coding Standards:** Use clean, idiomatic Rust. Use standard library `Mutex` / `OnceLock` for global configurations. Maintain proper safety checks inside PTY and path boundary resolvers.
- **TypeScript & React Styling:** Use CSS variables (`var(--bg-primary)`) from the premium design system to ensure visual consistency and responsiveness.
