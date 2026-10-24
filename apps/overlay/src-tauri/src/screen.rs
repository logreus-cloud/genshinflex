use crate::screen_text::{classify, Debounce, Names, Screen};
use std::{ffi::c_void, path::Path, ptr, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc}, thread, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::{core::HSTRING, Foundation::Uri, Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap}, Media::Ocr::OcrEngine, Security::Cryptography::CryptographicBuffer, Web::Http::HttpClient};

#[repr(C)]
#[derive(Default)]
struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
#[repr(C)]
struct Point { x: i32, y: i32 }
#[repr(C)]
struct BitmapHeader {
    size: u32, width: i32, height: i32, planes: u16, bit_count: u16,
    compression: u32, image_size: u32, x_pixels: i32, y_pixels: i32,
    colors_used: u32, colors_important: u32,
}
#[repr(C)]
struct BitmapInfo { header: BitmapHeader, color: [u32; 1] }

#[link(name = "user32")]
unsafe extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
    fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
    fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
    fn GetDC(hwnd: isize) -> isize;
    fn ReleaseDC(hwnd: isize, dc: isize) -> i32;
    fn IsIconic(hwnd: isize) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn QueryFullProcessImageNameW(process: isize, flags: u32, name: *mut u16, size: *mut u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}
#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(dc: isize) -> isize;
    fn DeleteDC(dc: isize) -> i32;
    fn CreateDIBSection(dc: isize, info: *const BitmapInfo, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> isize;
    fn SelectObject(dc: isize, object: isize) -> isize;
    fn BitBlt(dst: isize, x: i32, y: i32, w: i32, h: i32, src: isize, sx: i32, sy: i32, operation: u32) -> i32;
    fn DeleteObject(object: isize) -> i32;
    fn GdiFlush() -> i32;
}
#[link(name = "runtimeobject")]
unsafe extern "system" {
    fn RoInitialize(mode: u32) -> i32;
    fn RoUninitialize();
}

struct Apartment;
impl Apartment {
    fn new() -> Option<Self> {
        let result = unsafe { RoInitialize(1) };
        if result < 0 { eprintln!("WinRT: HRESULT {result:#x}"); None } else { Some(Self) }
    }
}
impl Drop for Apartment { fn drop(&mut self) { unsafe { RoUninitialize() }; } }

struct CaptureDc { screen: isize, memory: isize, bitmap: isize, old: isize }
impl Drop for CaptureDc {
    fn drop(&mut self) {
        unsafe {
            if self.old != 0 { SelectObject(self.memory, self.old); }
            if self.bitmap != 0 { DeleteObject(self.bitmap); }
            if self.memory != 0 { DeleteDC(self.memory); }
            if self.screen != 0 { ReleaseDC(0, self.screen); }
        }
    }
}

fn game_window(hwnd: isize, cache: &mut (isize, u32, bool)) -> bool {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid); }
    if (hwnd, pid) == (cache.0, cache.1) { return cache.2; }
    let mut allowed = false;
    if pid != 0 {
        let process = unsafe { OpenProcess(0x1000, 0, pid) };
        if process != 0 {
            let mut name = [0u16; 32768];
            let mut size = name.len() as u32;
            if unsafe { QueryFullProcessImageNameW(process, 0, name.as_mut_ptr(), &mut size) } != 0 {
                let path = String::from_utf16_lossy(&name[..size as usize]);
                allowed = Path::new(&path).file_name().is_some_and(|file| {
                    let file = file.to_string_lossy();
                    file.eq_ignore_ascii_case("GenshinImpact.exe") || file.eq_ignore_ascii_case("YuanShen.exe")
                });
            }
            unsafe { CloseHandle(process); }
        }
    }
    *cache = (hwnd, pid, allowed);
    allowed
}

fn region(w: i32, h: i32) -> Option<(i32, i32, i32, i32)> {
    if w < 640 || h < 360 { return None; }
    let scale = (w as f64 / 1920.0).min(h as f64 / 1080.0);
    let x = (125.0 * scale).round() as i32;
    let y = (16.0 * scale).round() as i32;
    let right = ((125.0 + 345.0) * scale).round() as i32;
    let bottom = ((16.0 + 65.0) * scale).round() as i32;
    let right = right.min(w);
    let bottom = bottom.min(h);
    (right > x && bottom > y).then_some((x, y, right - x, bottom - y))
}

fn intersects(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
    a.0 < b.0.saturating_add(b.2) && b.0 < a.0.saturating_add(a.2)
        && a.1 < b.1.saturating_add(b.3) && b.1 < a.1.saturating_add(a.3)
}

fn capture(hwnd: isize, window: &WebviewWindow) -> Option<(Vec<u8>, u32, u32)> {
    let mut client = Rect::default();
    if unsafe { IsIconic(hwnd) } != 0 || unsafe { GetClientRect(hwnd, &mut client) } == 0 { return None; }
    let (x, y, w, h) = region(client.right - client.left, client.bottom - client.top)?;
    let mut origin = Point { x: 0, y: 0 };
    if unsafe { ClientToScreen(hwnd, &mut origin) } == 0 { return None; }
    let target = (origin.x + x, origin.y + y, w, h);
    if window.is_visible().unwrap_or(false) {
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            if intersects(target, (pos.x, pos.y, size.width as i32, size.height as i32)) { return None; }
        }
    }
    let mut dc = CaptureDc { screen: unsafe { GetDC(0) }, memory: 0, bitmap: 0, old: 0 };
    if dc.screen == 0 { return None; }
    dc.memory = unsafe { CreateCompatibleDC(dc.screen) };
    if dc.memory == 0 { return None; }
    let info = BitmapInfo { header: BitmapHeader {
        size: std::mem::size_of::<BitmapHeader>() as u32, width: w, height: -h,
        planes: 1, bit_count: 32, compression: 0, image_size: 0,
        x_pixels: 0, y_pixels: 0, colors_used: 0, colors_important: 0,
    }, color: [0] };
    let mut bits = ptr::null_mut();
    dc.bitmap = unsafe { CreateDIBSection(dc.screen, &info, 0, &mut bits, 0, 0) };
    if dc.bitmap == 0 || bits.is_null() { return None; }
    dc.old = unsafe { SelectObject(dc.memory, dc.bitmap) };
    if dc.old == 0 || dc.old == -1 { dc.old = 0; return None; }
    if unsafe { BitBlt(dc.memory, 0, 0, w, h, dc.screen, target.0, target.1, 0x00CC0020) } == 0 { return None; }
    if unsafe { GdiFlush() } == 0 { return None; }
    let len = (w as usize).checked_mul(h as usize)?.checked_mul(4)?;
    Some((unsafe { std::slice::from_raw_parts(bits as *const u8, len) }.to_vec(), w as u32, h as u32))
}

pub fn prepare(bgra: &[u8], w: u32, h: u32) -> Option<(Vec<u8>, u32, u32)> {
    let len = (w as usize).checked_mul(h as usize)?;
    if len == 0 || bgra.len() < len.checked_mul(4)? { return None; }
    let gray: Vec<u8> = bgra.chunks_exact(4).take(len).map(|pixel| {
        ((pixel[2] as u32 * 299 + pixel[1] as u32 * 587 + pixel[0] as u32 * 114) / 1000) as u8
    }).collect();
    let min = *gray.iter().min()?;
    let max = *gray.iter().max()?;
    if max - min < 16 { return None; }
    let stretched: Vec<u8> = gray.iter().map(|&value| ((value - min) as u32 * 255 / (max - min) as u32) as u8).collect();
    let (tw, th) = (w.checked_mul(2)?, h.checked_mul(2)?);
    let mut output = Vec::with_capacity((tw as usize).checked_mul(th as usize)?);
    for y in 0..th {
        let source_y = ((y as f32 + 0.5) / 2.0 - 0.5).max(0.0);
        let y0 = (source_y.floor() as u32).min(h - 1);
        let y1 = (y0 + 1).min(h - 1);
        let fy = source_y - y0 as f32;
        for x in 0..tw {
            let source_x = ((x as f32 + 0.5) / 2.0 - 0.5).max(0.0);
            let x0 = (source_x.floor() as u32).min(w - 1);
            let x1 = (x0 + 1).min(w - 1);
            let fx = source_x - x0 as f32;
            let at = |x: u32, y: u32| stretched[y as usize * w as usize + x as usize] as f32;
            let top = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
            let bottom = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
            output.push((top * (1.0 - fy) + bottom * fy).round() as u8);
        }
    }
    Some((output, tw, th))
}

fn engines() -> windows::core::Result<Vec<OcrEngine>> {
    let languages = OcrEngine::AvailableRecognizerLanguages()?;
    let mut found = Vec::new();
    let mut seen = [false; 3];
    for index in 0..languages.Size()? {
        let language = languages.GetAt(index)?;
        let tag = language.LanguageTag()?.to_string().to_lowercase();
        let group = ["ru", "en", "es"].iter().position(|prefix| tag.starts_with(prefix));
        if let Some(group) = group {
            if !seen[group] {
                if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                    found.push(engine);
                    seen[group] = true;
                }
            }
        }
    }
    Ok(found)
}

fn recognize(gray: &[u8], w: u32, h: u32, engines: &[OcrEngine], preferred: &mut usize, names: &Names) -> windows::core::Result<(Option<Screen>, Vec<String>)> {
    let buffer = CryptographicBuffer::CreateFromByteArray(gray)?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Gray8, w as i32, h as i32)?;
    let mut seen_lines = Vec::new();
    for index in std::iter::once(*preferred).chain((0..engines.len()).filter(|index| *index != *preferred)) {
        let result = match engines[index].RecognizeAsync(&bitmap).and_then(|action| action.join()) {
            Ok(result) => result,
            Err(error) => { eprintln!("OCR: {error}"); continue; }
        };
        let lines = result.Lines()?;
        let mut text = Vec::new();
        for line in 0..lines.Size()? { text.push(lines.GetAt(line)?.Text()?.to_string()); }
        seen_lines.extend(text.iter().cloned());
        if let Some(screen) = classify(&text, names) { *preferred = index; return Ok((Some(screen), seen_lines)); }
    }
    Ok((None, seen_lines))
}

fn fetch_names(base: &tauri::Url) -> Option<Names> {
    let url = base.join("data/overlay-characters.json").ok()?;
    let result = (|| -> windows::core::Result<String> {
        let client = HttpClient::new()?;
        let uri = Uri::CreateUri(&HSTRING::from(url.as_str()))?;
        Ok(client.GetStringAsync(&uri)?.join()?.to_string())
    })();
    match result {
        Ok(raw) if raw.len() > 2 * 1024 * 1024 => { eprintln!("Имена персонажей: ответ слишком большой"); None }
        Ok(raw) => Names::from_json(&raw).or_else(|| { eprintln!("Некорректный список персонажей"); None }),
        Err(error) => { eprintln!("Имена персонажей: {error}"); None }
    }
}

fn load_names(base: &tauri::Url, loading: &Arc<AtomicBool>) -> Option<Names> {
    if loading.swap(true, Ordering::AcqRel) { return None; }
    let (sender, receiver) = mpsc::channel();
    let base = base.clone();
    let in_progress = loading.clone();
    if let Err(error) = thread::Builder::new().name("overlay-names-http".into()).spawn(move || {
        let loaded = Apartment::new().and_then(|_apartment| fetch_names(&base));
        in_progress.store(false, Ordering::Release);
        let _ = sender.send(loaded);
    }) {
        loading.store(false, Ordering::Release);
        eprintln!("Имена персонажей: {error}");
        return None;
    }
    match receiver.recv_timeout(Duration::from_secs(15)) {
        Ok(loaded) => loaded,
        Err(mpsc::RecvTimeoutError::Timeout) => { eprintln!("Имена персонажей: время ожидания истекло"); None }
        Err(mpsc::RecvTimeoutError::Disconnected) => { eprintln!("Имена персонажей: загрузка прервана"); None }
    }
}

fn navigate(app: &AppHandle, window: &WebviewWindow, enabled: &Arc<AtomicBool>, hwnd: isize, screen: Screen) -> bool {
    let base = app.state::<crate::Settings>().base.clone();
    let window = window.clone();
    let enabled = enabled.clone();
    let (sender, receiver) = mpsc::channel();
    if let Err(error) = app.run_on_main_thread(move || {
        let applied = (|| {
            if !enabled.load(Ordering::SeqCst) || unsafe { GetForegroundWindow() } != hwnd { return false; }
            let Ok(current) = window.url() else { return false };
            if current.origin() != base.origin() { return false; }
            let path = current.path();
            let (prefix, plain) = if let Some(rest) = path.strip_prefix("/en/") { ("/en", format!("/{rest}")) }
                else if let Some(rest) = path.strip_prefix("/es/") { ("/es", format!("/{rest}")) }
                else { ("", path.to_owned()) };
            if plain != "/overlay/" && !plain.starts_with("/overlay/c/") && !plain.starts_with("/overlay/banners") { return false; }
            let suffix = match screen { Screen::Wishes => "banners/".to_owned(), Screen::Character(slug) => format!("c/{slug}/") };
            let target_path = format!("{prefix}/overlay/{suffix}");
            if path == target_path { return true; }
            let Ok(target) = base.join(target_path.trim_start_matches('/')) else { return false };
            match window.navigate(target) {
                Ok(()) => true,
                Err(error) => { eprintln!("Распознавание экрана: {error}"); false }
            }
        })();
        let _ = sender.send(applied);
    }) {
        eprintln!("Распознавание экрана: {error}");
        return false;
    }
    receiver.recv_timeout(Duration::from_secs(1)).unwrap_or(false)
}

pub fn start(app: AppHandle, window: WebviewWindow, enabled: Arc<AtomicBool>) {
    thread::spawn(move || {
        let Some(_apartment) = Apartment::new() else { return };
        let engines = match engines() {
            Ok(engines) if !engines.is_empty() => engines,
            Ok(_) => { eprintln!("OCR: нет языков ru/en/es"); return; }
            Err(error) => { eprintln!("OCR: {error}"); return; }
        };
        let base = app.state::<crate::Settings>().base.clone();
        let (names_tx, names_rx) = mpsc::channel();
        if let Err(error) = thread::Builder::new().name("overlay-names".into()).spawn(move || {
            let Some(_apartment) = Apartment::new() else { return };
            let loading = Arc::new(AtomicBool::new(false));
            loop {
                let loaded = load_names(&base, &loading);
                let delay = if loaded.is_some() { Duration::from_secs(6 * 3600) } else { Duration::from_secs(5 * 60) };
                if let Some(names) = loaded {
                    if names_tx.send(names).is_err() { return; }
                }
                thread::sleep(delay);
            }
        }) { eprintln!("Имена персонажей: {error}"); }
        let empty = Names::default();
        let mut names = None;
        let mut debounce = Debounce::default();
        let mut cache = (0, 0, false);
        let mut preferred = 0;
        loop {
            while let Ok(loaded) = names_rx.try_recv() { names = Some(loaded); }
            let hwnd = unsafe { GetForegroundWindow() };
            if !enabled.load(Ordering::Relaxed) || hwnd == 0 || !game_window(hwnd, &mut cache) {
                debounce.push(None);
                thread::sleep(Duration::from_millis(1500));
                continue;
            }
            if let Some((bgra, w, h)) = capture(hwnd, &window) {
                let detected = match prepare(&bgra, w, h) {
                    Some((gray, w, h)) => match recognize(&gray, w, h, &engines, &mut preferred, names.as_ref().unwrap_or(&empty)) {
                        Ok((screen, _)) => screen,
                        Err(error) => { eprintln!("OCR: {error}"); None }
                    },
                    None => None,
                };
                if let Some(screen) = debounce.push(detected) {
                    if enabled.load(Ordering::SeqCst) && unsafe { GetForegroundWindow() } == hwnd
                        && navigate(&app, &window, &enabled, hwnd, screen.clone())
                        && enabled.load(Ordering::SeqCst) {
                        debounce.mark_applied(screen);
                    }
                }
            }
            thread::sleep(Duration::from_millis(700));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use crate::screen_text::SAMPLE_NAMES;
    use png::{BitDepth, ColorType, Decoder};

    #[test]
    #[ignore]
    fn samples() {
        let Some(directory) = std::env::var_os("GF_SCREEN_SAMPLES") else { return };
        let _apartment = Apartment::new().expect("WinRT");
        let engines = engines().expect("OCR languages");
        assert!(!engines.is_empty(), "OCR languages");
        let names = Names::from_json(SAMPLE_NAMES).unwrap();
        let labels = fs::read_to_string(Path::new(&directory).join("labels.tsv")).unwrap();
        let mut total = 0;
        let mut correct = 0;
        let mut preferred = 0;
        for row in labels.lines().filter(|row| !row.trim().is_empty()) {
            let (file, expected) = row.split_once('\t').expect("labels.tsv");
            let decoder = Decoder::new(fs::File::open(Path::new(&directory).join(file)).unwrap());
            let mut reader = decoder.read_info().unwrap();
            let mut buffer = vec![0; reader.output_buffer_size()];
            let info = reader.next_frame(&mut buffer).unwrap();
            assert_eq!(info.bit_depth, BitDepth::Eight, "{file}");
            let bytes = &buffer[..info.buffer_size()];
            let mut bgra = Vec::with_capacity((info.width * info.height * 4) as usize);
            match info.color_type {
                ColorType::Rgb => for pixel in bytes.chunks_exact(3) { bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]); },
                ColorType::Rgba => for pixel in bytes.chunks_exact(4) { bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]); },
                _ => panic!("RGB/RGBA 8 bit: {file}"),
            }
            let (x, y, w, h) = region(info.width as i32, info.height as i32).unwrap();
            let mut crop = Vec::with_capacity((w * h * 4) as usize);
            for row in y..y + h {
                let start = ((row * info.width as i32 + x) * 4) as usize;
                crop.extend_from_slice(&bgra[start..start + w as usize * 4]);
            }
            let (result, lines) = match prepare(&crop, w as u32, h as u32) {
                Some((gray, w, h)) => recognize(&gray, w, h, &engines, &mut preferred, &names).unwrap(),
                None => (None, Vec::new()),
            };
            let actual = match result { Some(Screen::Wishes) => "banners".to_owned(), Some(Screen::Character(slug)) => slug, None => "none".to_owned() };
            total += 1;
            if actual == expected { correct += 1; }
            else { eprintln!("{file}: ожидалось {expected}, получено {actual}, OCR: {lines:?}"); }
        }
        eprintln!("Распознавание: {correct}/{total}");
        assert!(total > 0 && correct * 100 >= total * 95);
    }
}
