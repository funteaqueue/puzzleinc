#[cfg(not(target_os = "macos"))]
use std::time::Duration;
use std::{collections::BTreeMap, sync::Mutex};
use tauri::WebviewWindow;
#[cfg(not(target_os = "macos"))]
use tauri::{AppHandle, Manager};
#[derive(Default)]
pub struct Keys(pub(crate) Mutex<BTreeMap<String, u32>>);
#[tauri::command]
pub fn set_keys(
    window: WebviewWindow,
    keys: Vec<String>,
    state: tauri::State<Keys>,
) -> Result<(), String> {
    super::panel(&window)?;
    if keys.len() > 80 {
        return Err("Ð—Ð°Ð±Ð°Ð³Ð°Ñ‚Ð¾ ÐºÐ»Ð°Ð²Ñ–Ñˆ".into());
    }
    *state.0.lock().unwrap() = keys
        .into_iter()
        .filter_map(|k| code(&k).map(|v| (k, v)))
        .collect();
    Ok(())
}
fn code(k: &str) -> Option<u32> {
    let b = k.as_bytes();
    if b.len() == 1 && b[0].is_ascii_alphanumeric() {
        return Some(b[0] as u32);
    }
    if let Some(n) = k
        .strip_prefix('F')
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| (1..=12).contains(n))
    {
        return Some(0x6f + n);
    }
    Some(match k {
        "Control" => 17,
        "Alt" => 18,
        "Shift" => 16,
        "Meta" => 91,
        "CapsLock" => 20,
        "Space" => 32,
        "Escape" => 27,
        "Enter" => 13,
        "Tab" => 9,
        "Backspace" => 8,
        "Delete" => 46,
        "Insert" => 45,
        "Home" => 36,
        "End" => 35,
        "PageUp" => 33,
        "PageDown" => 34,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        _ => return None,
    })
}
#[cfg(windows)]
fn reader() -> impl FnMut(&BTreeMap<String, u32>) -> Vec<String> {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    |keys| {
        keys.iter()
            .filter(|(_, v)| unsafe {
                GetAsyncKeyState(**v as i32) < 0 || (**v == 91 && GetAsyncKeyState(92) < 0)
            })
            .map(|(k, _)| k.clone())
            .collect()
    }
}
#[cfg(target_os = "linux")]
fn reader() -> impl FnMut(&BTreeMap<String, u32>) -> Vec<String> {
    use std::ffi::c_void;
    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(s: *const u8) -> *mut c_void;
        fn XQueryKeymap(d: *mut c_void, v: *mut u8) -> i32;
        fn XKeysymToKeycode(d: *mut c_void, s: u64) -> u8;
    }
    let d = unsafe { XOpenDisplay(std::ptr::null()) };
    let mut bits = [0u8; 32];
    let mut codes = BTreeMap::new();
    move |keys| {
        if d.is_null() {
            return vec![];
        }
        unsafe {
            XQueryKeymap(d, bits.as_mut_ptr());
        }
        keys.iter()
            .filter(|(_, v)| {
                let list = codes.entry(**v).or_insert_with(|| {
                    let syms = match **v {
                        17 => vec![0xffe3, 0xffe4],
                        18 => vec![0xffe9, 0xffea],
                        16 => vec![0xffe1, 0xffe2],
                        91 => vec![0xffeb, 0xffec],
                        20 => vec![0xffe5],
                        27 => vec![0xff1b],
                        13 => vec![0xff0d],
                        9 => vec![0xff09],
                        8 => vec![0xff08],
                        46 => vec![0xffff],
                        45 => vec![0xff63],
                        36 => vec![0xff50],
                        35 => vec![0xff57],
                        33 => vec![0xff55],
                        34 => vec![0xff56],
                        37..=40 => vec![0xff51 + **v - 37],
                        112..=123 => vec![0xffbe + **v - 112],
                        n => vec![n],
                    };
                    syms.into_iter()
                        .map(|s| unsafe { XKeysymToKeycode(d, s as u64) as usize })
                        .collect::<Vec<_>>()
                });
                list.iter()
                    .any(|n| *n != 0 && (bits[n / 8] & (1 << (n % 8))) != 0)
            })
            .map(|(k, _)| k.clone())
            .collect()
    }
}
#[cfg(not(target_os = "macos"))]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut read = reader();
        let mut previous = None;
        loop {
            let state = app.state::<Keys>();
            let keys = state.0.lock().unwrap();
            if keys.is_empty() {
                previous = None;
                drop(keys);
                std::thread::sleep(Duration::from_millis(120));
                continue;
            }
            let current = read(&keys);
            drop(keys);
            if previous.as_ref() != Some(&current) {
                if let Some(w) = app.get_webview_window("panel") {
                    let _ = w.eval(format!(
                        "window.puzzleKeys?.({})",
                        serde_json::to_string(&current).unwrap()
                    ));
                }
                previous = Some(current);
            }
            std::thread::sleep(Duration::from_millis(18));
        }
    });
}

#[cfg(target_os = "macos")]
pub use crate::macos::start_keys as start;
