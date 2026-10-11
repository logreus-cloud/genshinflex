// В релизе без окна консоли
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = genshinflex_overlay_lib::run() {
        eprintln!("GenshinFlex Overlay: {error}");
    }
}
