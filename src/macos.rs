use crate::{keys::Keys, panel, Result};
use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    CallbackResult, EventField,
};
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as Behavior};
use std::{cell::Cell, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

#[tauri::command]
pub fn input_permission(window: WebviewWindow, request: bool) -> Result<bool> {
    panel(&window)?;
    Ok(unsafe {
        if request {
            CGRequestListenEventAccess()
        } else {
            CGPreflightListenEventAccess()
        }
    })
}

pub async fn configure_overlay(window: &WebviewWindow) -> Result<()> {
    let w = window.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let result = w.ns_window().map(|ptr| {
                // AppKit access stays on the main thread while the Tauri window is alive.
                let ns = unsafe { &*ptr.cast::<NSWindow>() };
                let mut behavior = ns.collectionBehavior();
                behavior.remove(
                    Behavior::FullScreenPrimary
                        | Behavior::MoveToActiveSpace
                        | Behavior::FullScreenNone,
                );
                ns.setCollectionBehavior(
                    behavior | Behavior::CanJoinAllSpaces | Behavior::FullScreenAuxiliary,
                );
            });
            let _ = tx.send(result);
        })
        .map_err(crate::err)?;
    rx.await.map_err(crate::err)?.map_err(crate::err)
}

// Apple virtual key codes refer to physical keys, like KeyboardEvent.code in the editor.
fn physical_key(code: i64) -> Option<&'static str> {
    Some(match code {
        0 => "A",
        1 => "S",
        2 => "D",
        3 => "F",
        4 => "H",
        5 => "G",
        6 => "Z",
        7 => "X",
        8 => "C",
        9 => "V",
        11 => "B",
        12 => "Q",
        13 => "W",
        14 => "E",
        15 => "R",
        16 => "Y",
        17 => "T",
        18 => "1",
        19 => "2",
        20 => "3",
        21 => "4",
        22 => "6",
        23 => "5",
        25 => "9",
        26 => "7",
        28 => "8",
        29 => "0",
        31 => "O",
        32 => "U",
        34 => "I",
        35 => "P",
        36 => "Enter",
        37 => "L",
        38 => "J",
        40 => "K",
        45 => "N",
        46 => "M",
        48 => "Tab",
        49 => "Space",
        51 => "Backspace",
        53 => "Escape",
        57 => "CapsLock",
        96 => "F5",
        97 => "F6",
        98 => "F7",
        99 => "F3",
        100 => "F8",
        101 => "F9",
        103 => "F11",
        109 => "F10",
        111 => "F12",
        114 => "Insert",
        115 => "Home",
        116 => "PageUp",
        117 => "Delete",
        118 => "F4",
        119 => "End",
        120 => "F2",
        121 => "PageDown",
        122 => "F1",
        123 => "ArrowLeft",
        124 => "ArrowRight",
        125 => "ArrowDown",
        126 => "ArrowUp",
        _ => return None,
    })
}

pub fn start_keys(app: AppHandle) {
    std::thread::spawn(move || loop {
        let enabled = || !app.state::<Keys>().0.lock().unwrap().is_empty();
        if enabled() && unsafe { CGPreflightListenEventAccess() } {
            let disabled = Cell::new(false);
            let caps = Cell::new(None);
            let _ = CGEventTap::with_enabled(
                CGEventTapLocation::Session,
                CGEventTapPlacement::TailAppendEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::KeyDown, CGEventType::FlagsChanged],
                |_, kind, event| {
                    if matches!(
                        kind,
                        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
                    ) {
                        disabled.set(true);
                        CFRunLoop::get_current().stop();
                        return CallbackResult::Keep;
                    }
                    let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                    let flags = event.get_flags().bits();
                    let Some(key) = physical_key(code) else {
                        return CallbackResult::Keep;
                    };
                    if matches!(kind, CGEventType::FlagsChanged) {
                        let latched = flags & 0x10000 != 0;
                        if key != "CapsLock" || caps.replace(Some(latched)) == Some(latched) {
                            return CallbackResult::Keep;
                        }
                    } else if event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT)
                        != 0
                        || key == "CapsLock"
                    {
                        return CallbackResult::Keep;
                    }
                    if !app.state::<Keys>().0.lock().unwrap().contains_key(key) {
                        return CallbackResult::Keep;
                    }
                    let mut down: Vec<_> = [
                        ("Shift", 0x20000),
                        ("Control", 0x40000),
                        ("Alt", 0x80000),
                        ("Meta", 0x100000),
                    ]
                    .into_iter()
                    .filter(|(_, mask)| flags & mask != 0)
                    .map(|(name, _)| name)
                    .collect();
                    let baseline = down.clone();
                    down.push(key);
                    if let Some(w) = app.get_webview_window("panel") {
                        let samples = serde_json::json!([baseline, down, baseline]);
                        let _ = w.eval(format!(
                            "for(const keys of {samples}) window.puzzleKeys?.(keys)"
                        ));
                    }
                    CallbackResult::Keep
                },
                || {
                    while !disabled.get() && enabled() && unsafe { CGPreflightListenEventAccess() }
                    {
                        CFRunLoop::run_in_mode(
                            unsafe { kCFRunLoopDefaultMode },
                            Duration::from_secs(1),
                            false,
                        );
                    }
                },
            );
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}
