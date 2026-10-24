use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Manager, Url, WebviewWindow};

#[derive(Default)]
pub struct WishLinkState(Mutex<Option<String>>);

// Пробуем оба лога: первый может существовать, но не вести к кэшу (например, другой клиент)
fn cache_path() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE")?);
    let logs = [
        home.join(r"AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt"),
        home.join(r"AppData\LocalLow\miHoYo\原神\output_log.txt"),
    ];
    logs.iter().find_map(|path| cache_from_log(&fs::read_to_string(path).ok()?).filter(|file| file.exists()))
}

fn cache_from_log(log: &str) -> Option<PathBuf> {
    let mut game_data = None;
    for line in log.lines() {
        for (at, _) in line.match_indices("_Data") {
            let end = at + "_Data".len();
            let prefix = &line[..end];
            if !prefix.ends_with("GenshinImpact_Data") && !prefix.ends_with("YuanShen_Data") { continue; }
            let start = prefix.match_indices(":/")
                .filter(|(at, _)| *at > 0 && prefix.as_bytes()[at - 1].is_ascii_alphabetic())
                .map(|(at, _)| at - 1).last();
            if let Some(start) = start {
                game_data = Some(PathBuf::from(line[start..end].replace('/', "\\")));
            }
        }
    }
    let dirs: Vec<_> = fs::read_dir(game_data?.join("webCaches")).ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .collect();
    let versioned = dirs.iter().filter_map(|entry| {
        let name = entry.file_name();
        let version: Option<Vec<u64>> = name.to_str()?.split('.').map(|part| part.parse().ok()).collect();
        Some((version?, entry.path()))
    }).max_by(|a, b| a.0.cmp(&b.0)).map(|(_, path)| path);
    let dir = versioned.or_else(|| dirs.into_iter()
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .max_by_key(|(modified, _)| *modified).map(|(_, path)| path))?;
    Some(dir.join(r"Cache\Cache_Data\data_2"))
}

fn valid_link(raw: &str) -> Option<String> {
    if raw.len() > 4096 { return None; }
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?;
    if url.scheme() != "https"
        || !(host.ends_with(".hoyoverse.com") || host.ends_with(".mihoyo.com"))
        || !url.query_pairs().any(|(key, value)| key == "authkey" && !value.is_empty()) {
        return None;
    }
    Some(raw.to_owned())
}

fn newest_link(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    text.rsplit("1/0/").find_map(|part| {
        let raw = part.split('\0').next()?.trim();
        (raw.contains("webview_gacha") && raw.contains("authkey=")).then_some(raw).and_then(valid_link)
    })
}

fn eval_link(window: &WebviewWindow, link: &str) -> bool {
    let Ok(json) = serde_json::to_string(link) else { return false };
    window.eval(format!("window.dispatchEvent(new CustomEvent('gf:wish-link', {{ detail: {json} }}))")).is_ok()
}

pub fn resend(window: &WebviewWindow) {
    let state = window.state::<WishLinkState>();
    let link = state.0.lock().unwrap().clone();
    if let Some(link) = link { eval_link(window, &link); }
}

pub fn start(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        let mut path: Option<PathBuf> = None;
        let mut searched: Option<Instant> = None;
        let mut previous: Option<(Option<SystemTime>, u64)> = None;
        let mut pending: Option<String> = None;
        loop {
            if searched.map_or(true, |at| at.elapsed() >= Duration::from_secs(30)) {
                let found = cache_path();
                if found != path { previous = None; }
                path = found;
                searched = Some(Instant::now());
            }
            if let Some(ref file) = path {
                if let Ok(metadata) = fs::metadata(file) {
                    let stamp = (metadata.modified().ok(), metadata.len());
                    if previous != Some(stamp) {
                        let mut bytes = Vec::new();
                        if File::open(file).and_then(|mut file| file.read_to_end(&mut bytes)).is_ok() {
                            previous = Some(stamp);
                            // Кэш без подходящей ссылки не отменяет ещё не доставленную
                            if let Some(link) = newest_link(&bytes) { pending = Some(link); }
                        }
                    }
                } else {
                    path = None;
                    previous = None;
                }
            }
            if let Some(link) = pending.clone() {
                let state = app.state::<WishLinkState>();
                let mut sent = state.0.lock().unwrap();
                if sent.as_deref() == Some(&link) {
                    pending = None;
                } else if eval_link(&window, &link) {
                    *sent = Some(link);
                    pending = None;
                }
            }
            thread::sleep(Duration::from_secs(3));
        }
    });
}
