#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Avoid WebKitGTK/NVIDIA Wayland explicit-sync failures; honor explicit user overrides.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let nvidia_loaded = std::path::Path::new("/sys/module/nvidia").exists();
        if nvidia_loaded && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
    }

    glasswing_lib::run();
}
