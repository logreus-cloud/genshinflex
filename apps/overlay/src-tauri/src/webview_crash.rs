use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ProcessFailedEventArgs2,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
        COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
        COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
        COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
        COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
        COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        ICoreWebView2, GetAvailableCoreWebView2BrowserVersionString,
    },
    NavigationCompletedEventHandler, ProcessFailedEventHandler, take_pwstr,
};
use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};

static ALLOW_ERROR_PAGE: AtomicBool = AtomicBool::new(false);

pub fn take_error_page_navigation() -> bool {
    ALLOW_ERROR_PAGE.swap(false, Ordering::SeqCst)
}

enum Kind {
    Crash,
    Offline,
}

const ERROR_PAGE: &str = r#"<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
html, body { width: 100%; min-height: 100%; margin: 0; }
body { background: #14122b; color: #ece9f7; font-family: "Segoe UI", system-ui, sans-serif; overflow-x: hidden; }
.drag { height: 32px; background: #1d1a38; cursor: move; }
.stage { min-height: calc(100vh - 32px); display: flex; align-items: center; justify-content: center; padding: 16px; }
.card { width: 100%; max-width: 360px; padding: 28px 24px; border: 1px solid #393251; border-radius: 16px; background: #211d3b; text-align: center; }
.icon { width: 48px; height: 48px; color: #e6c27a; }
h1 { margin: 16px 0 12px; color: #e6c27a; font-size: 22px; line-height: 1.25; }
p { margin: 0; line-height: 1.5; }
button { width: 100%; margin-top: 24px; padding: 12px 16px; border: 0; border-radius: 10px; background: #e6c27a; color: #14122b; font: 600 15px "Segoe UI", system-ui, sans-serif; cursor: pointer; }
.note { margin-top: 24px; color: #b8b3cd; font-size: 12px; overflow-wrap: anywhere; }
.note[hidden] { display: none; }
</style>
</head>
<body>
<div class="drag" id="drag"></div>
<div class="stage">
  <main class="card">
    <svg class="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="24" cy="24" r="19"></circle>
      <path stroke-linecap="round" d="M24 13v14"></path>
      <circle cx="24" cy="34" r="1" fill="currentColor" stroke="none"></circle>
    </svg>
    <h1 id="title"></h1>
    <p id="message"></p>
    <button id="reload" type="button"></button>
    <p class="note" id="note"></p>
  </main>
</div>
<script>
const home = __GF_HOME__;
const kind = "__GF_KIND__";
const language = navigator.language.toLowerCase().split("-")[0];
const strings = {
  ru: {
    crashTitle: "Панель перезапускается",
    crashMessage: n => `Страница панели завершилась с ошибкой. Попробуем открыть её снова через ${n} с.`,
    offlineTitle: "Нет связи с GenshinFlex",
    offlineMessage: n => `Проверьте интернет. Повторим через ${n} с.`,
    reload: "Обновить сейчас",
    note: "Если повторяется часто — напишите нам, приложив файл webview-crashes.log из %LOCALAPPDATA%\\com.genshinflex.overlay\\logs"
  },
  en: {
    crashTitle: "The panel is restarting",
    crashMessage: n => `The panel page crashed. Retrying in ${n} s.`,
    offlineTitle: "Can't reach GenshinFlex",
    offlineMessage: n => `Check your connection. Retrying in ${n} s.`,
    reload: "Reload now",
    note: "If this happens often, contact us and attach webview-crashes.log from %LOCALAPPDATA%\\com.genshinflex.overlay\\logs"
  },
  es: {
    crashTitle: "El panel se está reiniciando",
    crashMessage: n => `La página del panel falló. Reintentando en ${n} s.`,
    offlineTitle: "No se puede conectar con GenshinFlex",
    offlineMessage: n => `Revisa tu conexión. Reintentando en ${n} s.`,
    reload: "Recargar ahora",
    note: "Si ocurre a menudo, escríbenos y adjunta webview-crashes.log de %LOCALAPPDATA%\\com.genshinflex.overlay\\logs"
  }
};
const text = strings[language] || strings.ru;
document.documentElement.lang = strings[language] ? language : "ru";
document.getElementById("title").textContent = text[kind + "Title"];
document.getElementById("reload").textContent = text.reload;
const note = document.getElementById("note");
note.hidden = kind !== "crash";
if (!note.hidden) note.textContent = text.note;
let remaining = 15;
const update = () => {
  document.getElementById("message").textContent = text[kind + "Message"](remaining);
};
update();
document.getElementById("drag").addEventListener("mousedown", () => { location.href = "gf-overlay://drag"; });
// Переход один раз: повторные присваивания location.href отменяли бы медленную загрузку
let timer = 0;
const go = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = 0;
  location.href = home;
};
document.getElementById("reload").addEventListener("click", go);
timer = setInterval(() => {
  if (document.visibilityState !== "visible") return;
  remaining -= 1;
  if (remaining <= 0) go();
  else update();
}, 1000);
</script>
</body>
</html>"#;

// eprintln! паникует при ошибке записи, а паника внутри COM-обработчика может уронить приложение
macro_rules! log {
    ($($arg:tt)*) => {{ let _ = writeln!(std::io::stderr().lock(), $($arg)*); }};
}

fn error_page(kind: Kind, home: &str) -> String {
    let home = serde_json::to_string(home).unwrap_or_else(|_| "\"\"".to_string());
    let kind = match kind { Kind::Crash => "crash", Kind::Offline => "offline" };
    ERROR_PAGE.replace("__GF_HOME__", &home).replace("__GF_KIND__", kind)
}

fn show_error_page(sender: &ICoreWebView2, kind: Kind, home: &str) {
    let html = HSTRING::from(error_page(kind, home));
    ALLOW_ERROR_PAGE.store(true, Ordering::SeqCst);
    if let Err(error) = unsafe { sender.NavigateToString(&html) } {
        ALLOW_ERROR_PAGE.store(false, Ordering::SeqCst);
        log!("Страница ошибки WebView2: {error}");
    }
}

fn read_string(result: windows::core::Result<()>, value: PWSTR) -> Option<String> {
    let text = take_pwstr(value);
    result.ok().map(|_| text.chars().take(1024).collect())
}

fn write_log(dir: &Path, line: &str) {
    if let Err(error) = fs::create_dir_all(dir) {
        log!("Лог WebView2: {error}");
        return;
    }
    let path = dir.join("webview-crashes.log");
    let reset = match fs::metadata(&path) {
        Ok(file) => file.len().saturating_add(line.len() as u64) > 64 * 1024,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => { log!("Лог WebView2: {error}"); false }
    };
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(reset).append(!reset);
    match options.open(&path) {
        Ok(mut file) => if let Err(error) = file.write_all(line.as_bytes()) {
            log!("Лог WebView2: {error}");
        },
        Err(error) => log!("Лог WebView2: {error}"),
    }
}

// Ошибки настройки пишем и в файл: у релизной сборки нет консоли, stderr никто не видит
fn note(dir: Option<&Path>, text: &str) {
    log!("{text}");
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0);
    if let Some(dir) = dir { write_log(dir, &format!("utc={timestamp} {text}
")); }
}

pub fn watch(window: &tauri::WebviewWindow, home: String) {
    let log_dir = match window.app_handle().path().app_log_dir() {
        Ok(dir) => Some(dir),
        Err(error) => { log!("Лог WebView2: {error}"); None }
    };
    // Строка при запуске: по ней видно, что лог пишется, и какие версии у пользователя
    let runtime = {
        let mut value = PWSTR::null();
        read_string(unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut value) }, value)
    };
    note(log_dir.as_deref(), &format!("start app={} webview2={runtime:?}", env!("CARGO_PKG_VERSION")));
    let access_dir = log_dir.clone();
    if let Err(error) = window.with_webview(move |webview| {
        let setup_dir = log_dir.clone();
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => { note(setup_dir.as_deref(), &format!("WebView2: {error}")); return; }
        };
        let reloads = Mutex::new(VecDeque::<Instant>::new());
        let crash_log_dir = log_dir.clone();
        let crash_home = home.clone();
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else {
                log!("WebView2: событие сбоя без данных");
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED;
            let kind = unsafe { args.ProcessFailedKind(&mut kind) }.ok().map(|_| kind);
            let details = args.cast::<ICoreWebView2ProcessFailedEventArgs2>().ok();
            let reason = details.as_ref().and_then(|details| {
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED;
                unsafe { details.Reason(&mut reason) }.ok().map(|_| reason)
            });
            let exit_code = details.as_ref().and_then(|details| {
                let mut code = 0;
                unsafe { details.ExitCode(&mut code) }.ok().map(|_| code)
            });
            let description = details.as_ref().and_then(|details| {
                let mut value = PWSTR::null();
                read_string(unsafe { details.ProcessDescription(&mut value) }, value)
            });
            let url = sender.as_ref().and_then(|sender| {
                let mut value = PWSTR::null();
                read_string(unsafe { sender.Source(&mut value) }, value)
            }).map(|url| url.split(['?', '#']).next().unwrap_or_default().to_string()); // код входа из query в лог не пишем
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
                .map(|time| time.as_secs()).unwrap_or(0);
            let line = format!(
                "utc={timestamp} kind={kind:?} reason={reason:?} exit_code={exit_code:?} description={description:?} url={url:?}\n"
            );
            log!("WebView2: {}", line.trim_end());
            if let Some(dir) = &crash_log_dir { write_log(dir, &line); }

            let reload = kind.as_ref().is_some_and(|kind| {
                *kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || *kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
            });
            if !reload { return Ok(()); }
            let Some(sender) = sender else { return Ok(()); };
            let now = Instant::now();
            let mut recent = match reloads.lock() {
                Ok(recent) => recent,
                Err(error) => {
                    log!("Лимит перезагрузок WebView2: {error}");
                    show_error_page(&sender, Kind::Crash, &crash_home);
                    return Ok(());
                }
            };
            while recent.front().is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(60)) {
                recent.pop_front();
            }
            if recent.len() >= 3 {
                drop(recent);
                show_error_page(&sender, Kind::Crash, &crash_home);
                return Ok(());
            }
            recent.push_back(now);
            drop(recent);
            if let Err(error) = unsafe { sender.Reload() } {
                log!("Перезагрузка WebView2: {error}");
                show_error_page(&sender, Kind::Crash, &crash_home);
            }
            Ok(())
        }));
        let mut token = 0_i64;
        if let Err(error) = unsafe { core.add_ProcessFailed(&handler, &mut token) } {
            note(setup_dir.as_deref(), &format!("Подписка на сбои WebView2: {error}"));
        }
        let handler = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()); };
            let mut success = Default::default();
            if unsafe { args.IsSuccess(&mut success) }.is_err() || success.as_bool() {
                return Ok(());
            }
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
            if unsafe { args.WebErrorStatus(&mut status) }.is_err() {
                return Ok(());
            }
            let network_error = [
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
                COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
                COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
                COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
            ].contains(&status);
            if !network_error { return Ok(()); }
            let Some(sender) = sender else { return Ok(()); };
            let mut value = PWSTR::null();
            let Some(url) = read_string(unsafe { sender.Source(&mut value) }, value) else {
                return Ok(());
            };
            if url.starts_with("about:") || url.starts_with("data:") {
                return Ok(());
            }
            let url = url.split(['?', '#']).next().unwrap_or_default();
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
                .map(|time| time.as_secs()).unwrap_or(0);
            let line = format!("utc={timestamp} navigation_failed status={status:?} url={url:?}\n");
            log!("WebView2: {}", line.trim_end());
            if let Some(dir) = &log_dir { write_log(dir, &line); }
            show_error_page(&sender, Kind::Offline, &home);
            Ok(())
        }));
        let mut token = 0_i64;
        if let Err(error) = unsafe { core.add_NavigationCompleted(&handler, &mut token) } {
            note(setup_dir.as_deref(), &format!("Подписка на навигацию WebView2: {error}"));
        }
    }) {
        note(access_dir.as_deref(), &format!("Доступ к WebView2: {error}"));
    }
}
