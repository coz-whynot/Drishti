# Drishti — Tauri shell

A Tauri 2.x desktop wrapper for Drishti. Produces native installers
(`.msi` / `.dmg` / `.AppImage`) with a startup screen, native folder picker,
recent-projects list, and webview that loads the generated dashboard.

## Status

- ✅ Rust source complete: window, commands, plugins, file-preview path-traversal guard
- ✅ Frontend startup screen complete: pickup folder + recent projects + scan progress
- ✅ Icon set generated
- ⚠ **Build not yet validated on developer's primary machine** — Windows Defender
  Application Control (WDAC) on the dev machine blocks unsigned executables created
  by cargo's build scripts, so `npm run tauri build` fails locally with
  `os error 4551`.

The scaffold is correct and **should build on machines without WDAC blocking**:
Linux, macOS, or Windows machines without aggressive Application Control policies.

## Building

Prerequisites:
- Rust 1.70+ (any toolchain — MSVC or GNU works)
  - GNU on Windows: also requires real MinGW-w64 GCC (NOT LLVM-MinGW). Easiest:
    `winget install MSYS2.MSYS2` then add MSYS2's mingw64/bin to PATH.
- Node 18+ (for the frontend build script)
- Windows: Visual Studio Build Tools with "Desktop development with C++" workload
  (for MSVC toolchain) OR MSYS2 mingw-w64 (for GNU toolchain)

```bash
cd Drishti
npm install
npm run tauri build
```

Output: `src-tauri/target/release/bundle/nsis/Drishti_1.0.0_x64-setup.exe`

## CI build (recommended)

Local builds are flaky due to per-machine policy variation. The reliable path is
GitHub Actions on a clean `windows-latest` runner. A workflow file lives in
`.github/workflows/release.yml` (TODO — Phase F).

## Architecture

- `src/main.rs` — thin entrypoint
- `src/lib.rs` — Tauri commands (pick_folder, start_scan, read_file, recent projects)
- `tauri.conf.json` — window + bundle config
- `Cargo.toml` — Rust dependencies (tauri 2, tauri-plugin-dialog, tauri-plugin-shell)
- `icons/` — generated from `npx tauri icon`

The frontend Tauri loads is built by `scripts/build-tauri-frontend.js` into
`dist-tauri/index.html`. That page invokes Tauri commands then navigates the
webview to the generated `drishti.html` once a scan completes.

## Why scan via Node sidecar?

The scan logic (file walking, parsers, complexity engine, plugin loading) is
~3000 lines of JavaScript. Porting it to Rust would be weeks of work. The Tauri
shell shells out to `node src/scan.js <project>` instead, requiring Node on the
user's PATH. v1.1 may bundle Node as a Tauri sidecar to remove this requirement.
