use std::{sync::Mutex, thread};

use tauri::{webview::NewWindowResponse, AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const LABEL: &str = "hoyolab-map";

#[derive(Default)]
pub struct MapState { status: Mutex<MapStatus> }

#[derive(Default)]
struct MapStatus { creating: bool, opened: bool }

pub fn is_official_map(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("act.hoyolab.com")
        && url.path().starts_with("/ys/app/interactive-map") && url.port().is_none()
        && url.username().is_empty() && url.password().is_none()
}

fn allowed(url: &Url) -> bool {
    if url.scheme() != "https" || url.port().is_some()
        || !url.username().is_empty() || url.password().is_some() { return false; }
    let Some(host) = url.host_str() else { return false };
    matches!(host, "hoyolab.com" | "hoyoverse.com")
        || host.ends_with(".hoyolab.com") || host.ends_with(".hoyoverse.com")
}

fn opened(app: &AppHandle) -> bool {
    match app.state::<MapState>().status.lock() {
        Ok(status) => status.opened,
        Err(error) => { eprintln!("Карта HoYoLAB: {error}"); false }
    }
}

fn fit_to_work_area(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    let area = monitor.work_area();
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let frame_width = outer.width.saturating_sub(inner.width);
    let frame_height = outer.height.saturating_sub(inner.height);
    let scale = monitor.scale_factor();
    let min_width = ((720.0 * scale).ceil() as u32).saturating_add(frame_width).min(area.size.width);
    let min_height = ((480.0 * scale).ceil() as u32).saturating_add(frame_height).min(area.size.height);
    window.set_min_size(Some(PhysicalSize::new(min_width.saturating_sub(frame_width), min_height.saturating_sub(frame_height))))?;
    let width = outer.width.max(min_width).min(area.size.width);
    let height = outer.height.max(min_height).min(area.size.height);
    if width != outer.width || height != outer.height {
        window.set_size(PhysicalSize::new(width.saturating_sub(frame_width), height.saturating_sub(frame_height)))?;
    }
    let position = window.outer_position()?;
    let x = (position.x as i64).clamp(area.position.x as i64, area.position.x as i64 + area.size.width.saturating_sub(width) as i64) as i32;
    let y = (position.y as i64).clamp(area.position.y as i64, area.position.y as i64 + area.size.height.saturating_sub(height) as i64) as i32;
    if x != position.x || y != position.y { window.set_position(PhysicalPosition::new(x, y))?; }
    Ok(())
}

fn create(app: &AppHandle, url: Url) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    let popup_app = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Карта HoYoLAB — GenshinFlex").inner_size(1100.0, 750.0).min_inner_size(720.0, 480.0)
        .decorations(true).always_on_top(true).skip_taskbar(true).visible(false)
        .on_navigation(move |url| {
            if allowed(url) { return true; }
            if matches!(url.scheme(), "http" | "https") {
                if let Err(error) = nav_app.opener().open_url(url.to_string(), None::<&str>) { eprintln!("Браузер: {error}"); }
            }
            false
        })
        .on_new_window(move |url, _| {
            if allowed(&url) { return NewWindowResponse::Allow; }
            if matches!(url.scheme(), "http" | "https") {
                if let Err(error) = popup_app.opener().open_url(url.to_string(), None::<&str>) { eprintln!("Браузер: {error}"); }
            }
            NewWindowResponse::Deny
        });
    if let Some(main) = app.get_webview_window("main") {
        let monitor = match main.current_monitor()? {
            Some(monitor) => Some(monitor),
            None => main.primary_monitor()?,
        };
        let position = main.outer_position()?;
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let width = 1100.0_f64.min((area.size.width as f64 / scale - 32.0).max(1.0));
            let height = 750.0_f64.min((area.size.height as f64 / scale - 48.0).max(1.0));
            let x = (position.x as i64 - (width * scale).ceil() as i64 - 12).max(area.position.x as i64);
            let y = (position.y as i64).clamp(area.position.y as i64, area.position.y as i64 + area.size.height.saturating_sub((height * scale).ceil() as u32) as i64);
            builder = builder.inner_size(width, height).min_inner_size(720.0_f64.min(width), 480.0_f64.min(height))
                .position(x as f64 / scale, y as f64 / scale);
        }
    }
    let window = builder.build()?;
    let close_app = app.clone();
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = close_window.hide() { eprintln!("Карта HoYoLAB: {error}"); }
            match close_app.state::<MapState>().status.lock() {
                Ok(mut status) => status.opened = false,
                Err(error) => eprintln!("Карта HoYoLAB: {error}"),
            }
        }
    });
    // Обработчик закрытия уже стоит: ошибка подгонки не должна оставить окно, которое крестик уничтожает
    if let Err(error) = fit_to_work_area(&window) { eprintln!("Карта HoYoLAB: {error}"); }
    Ok(window)
}

pub fn open(app: &AppHandle, url: Url) {
    let app = app.clone();
    thread::spawn(move || {
        let state = app.state::<MapState>();
        let Ok(mut status) = state.status.lock() else { eprintln!("Карта HoYoLAB: состояние недоступно"); return };
        if status.creating { return; }
        status.creating = true;
        drop(status);
        let result = match app.get_webview_window(LABEL) {
            Some(window) => Ok(window),
            None => create(&app, url),
        };
        let Ok(mut status) = state.status.lock() else { eprintln!("Карта HoYoLAB: состояние недоступно"); return };
        status.creating = false;
        match result {
            Ok(window) => {
                status.opened = true;
                drop(status);
                if let Err(error) = window.show().and_then(|_| window.set_focus()) { eprintln!("Карта HoYoLAB: {error}"); }
            }
            Err(error) => eprintln!("Карта HoYoLAB: {error}"),
        }
    });
}

pub fn hide_with_panel(app: &AppHandle) {
    if !opened(app) { return; }
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window.hide() { eprintln!("Карта HoYoLAB: {error}"); }
    }
}

pub fn restore_with_panel(app: &AppHandle) {
    if !opened(app) { return; }
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window.show() { eprintln!("Карта HoYoLAB: {error}"); }
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed, is_official_map};
    use tauri::Url;

    fn parse(value: &str) -> Url { Url::parse(value).expect("тестовый URL") }

    #[test]
    fn official_map_url() {
        for url in [
            "https://act.hoyolab.com/ys/app/interactive-map/index.html",
            "https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=ru-ru",
        ] { assert!(is_official_map(&parse(url)), "{url}"); }
        for url in [
            "http://act.hoyolab.com/ys/app/interactive-map/index.html",
            "https://evilhoyolab.com/ys/app/interactive-map/index.html",
            "https://act.hoyolab.com.evil.io/ys/app/interactive-map/index.html",
            "https://act.hoyolab.com:8443/ys/app/interactive-map/index.html",
            "https://user@act.hoyolab.com/ys/app/interactive-map/index.html",
            "https://act.hoyolab.com/ys/app/another-map/index.html",
        ] { assert!(!is_official_map(&parse(url)), "{url}"); }
    }

    #[test]
    fn map_navigation() {
        for url in [
            "https://hoyolab.com/",
            "https://act.hoyolab.com/ys/app/interactive-map/",
            "https://account.hoyoverse.com/",
        ] { assert!(allowed(&parse(url)), "{url}"); }
        for url in [
            "http://hoyolab.com/",
            "https://evilhoyolab.com/",
            "https://hoyolab.com.evil.io/",
            "https://hoyoverse.com.evil.io/",
            "https://hoyolab.com:8443/",
            "https://user@hoyolab.com/",
            "https://user:pass@account.hoyoverse.com/",
            "mailto:test@hoyolab.com",
        ] { assert!(!allowed(&parse(url)), "{url}"); }
    }
}
