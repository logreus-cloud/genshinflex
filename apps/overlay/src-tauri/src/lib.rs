mod updates;
mod wish_cache;

use serde::Deserialize;
use std::{fs, thread, time::Duration};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WebviewUrl, WebviewWindowBuilder,
    window::Color,
    webview::PageLoadEvent,
    AppHandle, Manager, Url, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

const DEFAULT_URL: &str = "https://genshinflex.com";
const DEFAULT_SHORTCUT: &str = "Alt+G";

#[derive(Default, Deserialize)]
struct SettingsFile {
    base_url: Option<String>,
    shortcut: Option<String>,
}

struct Settings {
    base: Url,
    shortcut: String,
}

fn valid_base(value: &str) -> Option<Url> {
    let mut url = Url::parse(value).ok()?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return None;
    }
    url.set_path("/");
    Some(url)
}

fn settings(app: &AppHandle) -> Settings {
    let file = app.path().app_config_dir().ok().map(|p| p.join("settings.json"));
    let saved = file.and_then(|path| match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<SettingsFile>(&raw) {
            Ok(settings) => Some(settings),
            Err(error) => { eprintln!("Некорректный settings.json: {error}"); None }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => { eprintln!("Не удалось прочитать settings.json: {error}"); None }
    }).unwrap_or_default();
    let base = std::env::var("GF_OVERLAY_URL").ok().or(saved.base_url);
    let base = base.as_deref().and_then(valid_base).unwrap_or_else(|| {
        if let Some(value) = base { eprintln!("Недопустимый адрес оверлея: {value}"); }
        valid_base(DEFAULT_URL).unwrap()
    });
    Settings { base, shortcut: saved.shortcut.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| DEFAULT_SHORTCUT.into()) }
}

fn in_panel(path: &str) -> bool {
    let path = path.strip_prefix("/en").or_else(|| path.strip_prefix("/es")).filter(|rest| rest.starts_with('/')).unwrap_or(path);
    ["/overlay", "/account"].iter().any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")))
}

fn toggle(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let result = if window.is_visible().unwrap_or(false) {
            window.hide()
        } else {
            window.show().and_then(|_| window.set_focus())
        };
        if let Err(error) = result { eprintln!("Окно: {error}"); }
    }
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show().and_then(|_| window.set_focus()) { eprintln!("Окно: {error}"); }
    }
}

fn handle_link(app: &AppHandle, link: &Url) {
    if link.scheme() != "genshinflex" || link.host_str() != Some("auth")
        || !matches!(link.path(), "" | "/") || link.port().is_some()
        || !link.username().is_empty() || link.password().is_some() || link.fragment().is_some() { return; }
    let mut pairs = link.query_pairs();
    let code = pairs.find(|(key, _)| key == "code").map(|(_, value)| value.into_owned());
    let mut target = app.state::<Settings>().base.join("overlay/auth/").ok();
    let Some(ref mut target) = target else { return };
    if let Some(code) = code {
        if code.is_empty() || code.len() > 512 || !code.bytes().all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b)) { return; }
        target.query_pairs_mut().append_pair("code", &code);
    } else if let Some(error) = link.query_pairs().find(|(key, _)| key == "error").map(|(_, value)| value.into_owned()) {
        if error.is_empty() || error.len() > 512 { return; }
        target.query_pairs_mut().append_pair("error", &error);
    } else { return; }
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.navigate(target.clone()) { eprintln!("Deep link: {error}"); return; }
        show(app);
    }
}

fn tray(app: &tauri::App, settings: &Settings) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "toggle", "Показать/скрыть", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Автозапуск", true,
        app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
    let update_item = MenuItem::with_id(app, "update", "Обновлений нет", false, None::<&str>)?;
    let site = MenuItem::with_id(app, "site", "Открыть сайт", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &autostart, &update_item, &site, &quit])?;
    updates::set_menu_item(app.handle(), update_item);
    let base = settings.base.to_string();
    let check = autostart.clone();
    let mut builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(false)
        .tooltip(format!("GenshinFlex — {}", settings.shortcut))
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "autostart" => {
                let enabled = app.autolaunch().is_enabled().unwrap_or(false);
                let result = if enabled { app.autolaunch().disable() } else { app.autolaunch().enable() };
                if let Err(error) = result { eprintln!("Автозапуск: {error}"); }
                let _ = check.set_checked(app.autolaunch().is_enabled().unwrap_or(enabled));
            }
            "update" => updates::install(app),
            "site" => { if let Err(error) = app.opener().open_url(base.clone(), None::<&str>) { eprintln!("Браузер: {error}"); } }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() { builder = builder.icon(icon); }
    let tray = builder.build(app)?;
    updates::start(app.handle().clone());
    let tooltip_handle = app.handle().clone();
    let shortcut = settings.shortcut.clone();
    thread::spawn(move || {
        let mut system = System::new();
        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            let running = system.processes().values().any(|p| {
                let name = p.name().to_string_lossy();
                name.eq_ignore_ascii_case("GenshinImpact.exe") || name.eq_ignore_ascii_case("YuanShen.exe")
            });
            let mut tip = if running { format!("GenshinFlex — {shortcut}") }
                else { format!("GenshinFlex — {shortcut} · игра не запущена") };
            if updates::available(&tooltip_handle) { tip.push_str(" · доступно обновление"); }
            if let Err(error) = tray.set_tooltip(Some(tip)) { eprintln!("Трей: {error}"); }
            thread::sleep(Duration::from_secs(10));
        }
    });
    Ok(())
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let settings = settings(app.handle());
    app.manage(wish_cache::WishLinkState::default());
    app.manage(updates::UpdateState::default());
    let origin = settings.base.origin().ascii_serialization();
    let script = format!(r#"
        if (location.origin === {origin:?}) {{
            window.__GF_OVERLAY_APP__ = {version:?};
            window.open = function(url) {{
                if (url) {{
                    const next = new URL(String(url), location.href);
                    if (/^https?:$/.test(next.protocol)) location.href = next.href;
                }}
                return null;
            }};
            document.addEventListener('click', function(event) {{
                const link = event.target instanceof Element ? event.target.closest('a[target="_blank"]') : null;
                if (!link) return;
                event.preventDefault();
                const next = new URL(link.href, location.href);
                if (/^https?:$/.test(next.protocol)) location.href = next.href;
            }}, true);
        }}
    "#, origin = origin, version = env!("CARGO_PKG_VERSION"));
    let base = settings.base.clone();
    let handle = app.handle().clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(base.join("overlay/")?))
        .title("GenshinFlex Overlay").inner_size(420.0, 800.0).min_inner_size(360.0, 480.0)
        .decorations(false).transparent(true).background_color(Color(0, 0, 0, 0))
        .always_on_top(true).skip_taskbar(true).resizable(true).visible(false)
        .initialization_script(script)
        .on_navigation(move |url| {
            if url.scheme() == "gf-overlay" && url.host_str() == Some("update") { updates::install(&handle); return false; }
            // blob:/data: и прочие схемы не пускаем, даже если origin совпадает
            if !matches!(url.scheme(), "http" | "https") { return false; }
            // В панели — только компактные страницы и вход по почте; остальной сайт открываем в браузере,
            // иначе полная страница (оружие, персонаж) втискивается в узкое окно
            if url.origin() == base.origin() && in_panel(url.path()) { return true; }
            if let Err(error) = handle.opener().open_url(url.to_string(), None::<&str>) { eprintln!("Браузер: {error}"); }
            false
        });
    // Первый запуск: у правого края рабочей области, высота не больше экрана без панели задач
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
        let height = 800.0_f64.min(h - 48.0).max(480.0);
        builder = builder.inner_size(420.0, height).position(x + w - 420.0 - 24.0, y + ((h - height) / 2.0).max(0.0));
    }
    let window = builder.build()?;
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_window.hide();
        }
    });
    // Неверная клавиша из settings.json — возвращаемся к Alt+G, чтобы окно можно было открыть
    wish_cache::start(app.handle().clone(), window);
    let mut settings = settings;
    let register = |app: &tauri::App, shortcut: &str| app.global_shortcut().on_shortcut(shortcut, |app, _, event| {
        if event.state == ShortcutState::Pressed { toggle(app); }
    });
    if let Err(error) = register(app, &settings.shortcut) {
        eprintln!("Горячая клавиша {}: {error}", settings.shortcut);
        if settings.shortcut != DEFAULT_SHORTCUT {
            settings.shortcut = DEFAULT_SHORTCUT.into();
            if let Err(error) = register(app, DEFAULT_SHORTCUT) { eprintln!("Горячая клавиша {DEFAULT_SHORTCUT}: {error}"); }
        }
    }
    app.manage(Settings { base: settings.base.clone(), shortcut: settings.shortcut.clone() });
    tray(app, &settings)?;
    let deep_handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() { handle_link(&deep_handle, &url); }
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => for url in urls { handle_link(app.handle(), &url); },
        Ok(None) => for arg in std::env::args().skip(1) {
            if let Ok(url) = Url::parse(&arg) { handle_link(app.handle(), &url); }
        },
        Err(error) => eprintln!("Deep link: {error}"),
    }
    #[cfg(debug_assertions)]
    if let Err(error) = app.deep_link().register_all() { eprintln!("Регистрация deep link: {error}"); }
    Ok(())
}

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        // Ссылку из второго запуска передаёт deep-link (feature в single-instance) — здесь только показываем окно,
        // иначе код входа обработался бы дважды
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::POSITION | StateFlags::SIZE).build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(setup)
        .on_page_load(|webview, payload| {
            // on_page_load отдаёт Webview, а ссылку шлём в окно main
            if matches!(payload.event(), PageLoadEvent::Finished) {
                if let Some(window) = webview.app_handle().get_webview_window("main") {
                    wish_cache::resend(&window);
                    updates::resend(&window);
                }
            }
        })
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::in_panel;

    #[test]
    fn panel_keeps_only_overlay_and_account() {
        for path in ["/overlay/", "/overlay/c/furina/", "/en/overlay/banners/", "/es/account/login/", "/account/"] {
            assert!(in_panel(path), "{path}");
        }
        for path in ["/", "/weapons/x/", "/characters/furina/", "/en/", "/overlayx/", "/enoverlay/", "/en"] {
            assert!(!in_panel(path), "{path}");
        }
    }
}
