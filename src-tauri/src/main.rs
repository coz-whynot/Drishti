// Drishti desktop entrypoint — thin shim that delegates to lib.rs::run().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    drishti_lib::run();
}
