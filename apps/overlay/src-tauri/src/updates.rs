use serde::Serialize;
use std::{sync::Mutex, thread, time::Duration};
use tauri::{menu::MenuItem, AppHandle, Manager, WebviewWindow, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Copy, PartialEq)]
enum Phase { Available, Installing, Error }

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Installing => "installing",
            Self::Error => "error",
        }
    }
}

#[derive(Default)]
struct Inner {
    pending: Option<Update>,
    phase: Option<Phase>,
    version: Option<String>,
}

#[derive(Default)]
pub struct UpdateState {
    inner: Mutex<Inner>,
    item: Mutex<Option<MenuItem<Wry>>>,
}

#[derive(Serialize)]
struct Message<'a> {
    state: &'a str,
    version: &'a str,
}

fn send(window: &WebviewWindow, phase: Phase, version: &str) {
    let Ok(json) = serde_json::to_string(&Message { state: phase.as_str(), version }) else { return };
    if let Err(error) = window.eval(format!("window.dispatchEvent(new CustomEvent('gf:update', {{ detail: {json} }}))")) {
        eprintln!("Обновление: {error}");
    }
}

pub fn resend(window: &WebviewWindow) {
    let state = window.state::<UpdateState>();
    let snapshot = {
        let inner = state.inner.lock().unwrap();
        inner.phase.zip(inner.version.clone())
    };
    if let Some((phase, version)) = snapshot { send(window, phase, &version); }
}

// Публикуем только из главного потока и со свежим снимком: так «доступно» из фоновой проверки
// не перезапишет уже показанное «загрузка», а пункт меню не меняется из чужого потока
fn publish(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || publish_now(&handle)) { eprintln!("Обновление: {error}"); }
}

fn publish_now(app: &AppHandle) {
    let state = app.state::<UpdateState>();
    // Копия пункта, а не удержание мьютекса: set_text ждёт главный поток, а он может сам вызвать publish (клик «Обновить»)
    let item = state.item.lock().unwrap().clone();
    let snapshot = {
        let inner = state.inner.lock().unwrap();
        inner.phase.zip(inner.version.clone())
    };
    if let Some(item) = item.as_ref() {
        let (label, enabled) = match &snapshot {
            Some((Phase::Installing, _)) => ("Загрузка обновления…".to_string(), false),
            Some((_, version)) => (format!("Обновить до {version}"), true),
            None => ("Обновлений нет".to_string(), false),
        };
        if let Err(error) = item.set_text(label) { eprintln!("Трей: {error}"); }
        if let Err(error) = item.set_enabled(enabled) { eprintln!("Трей: {error}"); }
    }
    let Some(window) = app.get_webview_window("main") else { return };
    match snapshot {
        Some((phase, version)) => send(&window, phase, &version),
        None => { let _ = window.eval("window.dispatchEvent(new CustomEvent('gf:update', { detail: { state: 'none' } }))"); }
    }
}

pub fn set_menu_item(app: &AppHandle, item: MenuItem<Wry>) {
    *app.state::<UpdateState>().item.lock().unwrap() = Some(item);
    publish(app);
}

pub fn available(app: &AppHandle) -> bool {
    app.state::<UpdateState>().inner.lock().unwrap().version.is_some()
}

pub fn install(app: &AppHandle) {
    let state = app.state::<UpdateState>();
    let update = {
        let mut inner = state.inner.lock().unwrap();
        if inner.phase == Some(Phase::Installing) { return; }
        let Some(update) = inner.pending.take() else { drop(inner); publish(app); return };
        inner.phase = Some(Phase::Installing);
        update
    };
    publish(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
            eprintln!("Обновление: {error}");
            let state = app.state::<UpdateState>();
            let mut inner = state.inner.lock().unwrap();
            inner.pending = Some(update);
            inner.phase = Some(Phase::Error);
            drop(inner);
            publish(&app);
        } else {
            app.restart();
        }
    });
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(20));
        loop {
            match tauri::async_runtime::block_on(async { app.updater()?.check().await }) {
                Ok(update) => {
                    let state = app.state::<UpdateState>();
                    let mut inner = state.inner.lock().unwrap();
                    if inner.phase != Some(Phase::Installing) {
                        let version = update.as_ref().map(|update| update.version.clone());
                        let phase = version.as_ref().map(|_| Phase::Available);
                        let changed = inner.phase != phase || inner.version != version;
                        inner.pending = update;
                        inner.phase = phase;
                        inner.version = version;
                        drop(inner);
                        if changed { publish(&app); }
                    }
                }
                Err(error) => eprintln!("Проверка обновления: {error}"),
            }
            thread::sleep(Duration::from_secs(6 * 60 * 60));
        }
    });
}
