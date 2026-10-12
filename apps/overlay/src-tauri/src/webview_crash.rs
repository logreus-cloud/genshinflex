use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::Mutex,
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
    },
    ProcessFailedEventHandler, take_pwstr,
};
use windows::core::{Interface, PWSTR};

// eprintln! паникует при ошибке записи, а паника внутри COM-обработчика может уронить приложение
macro_rules! log {
    ($($arg:tt)*) => {{ let _ = writeln!(std::io::stderr().lock(), $($arg)*); }};
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

pub fn watch(window: &tauri::WebviewWindow) {
    let log_dir = match window.app_handle().path().app_log_dir() {
        Ok(dir) => Some(dir),
        Err(error) => { log!("Лог WebView2: {error}"); None }
    };
    if let Err(error) = window.with_webview(move |webview| {
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => { log!("WebView2: {error}"); return; }
        };
        let reloads = Mutex::new(VecDeque::<Instant>::new());
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
            if let Some(dir) = &log_dir { write_log(dir, &line); }

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
                    return Ok(());
                }
            };
            while recent.front().is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(60)) {
                recent.pop_front();
            }
            if recent.len() >= 3 { return Ok(()); }
            recent.push_back(now);
            drop(recent);
            if let Err(error) = unsafe { sender.Reload() } {
                log!("Перезагрузка WebView2: {error}");
            }
            Ok(())
        }));
        let mut token = 0_i64;
        if let Err(error) = unsafe { core.add_ProcessFailed(&handler, &mut token) } {
            log!("Подписка на сбои WebView2: {error}");
        }
    }) {
        log!("Доступ к WebView2: {error}");
    }
}
