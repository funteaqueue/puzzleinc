#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod keys;
mod relay;
use serde_json::{json, Value};
use std::{
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::watch;
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
fn personal() -> Value {
    serde_json::from_str(include_str!("../.runtime/personal-session.json")).unwrap()
}
fn panel(w: &WebviewWindow) -> Result<()> {
    if w.label() == "panel" {
        Ok(())
    } else {
        Err("Недоступно".into())
    }
}
#[tauri::command]
fn startup(window: WebviewWindow) -> Result<Value> {
    panel(&window)?;
    let monitors = window.available_monitors().map_err(err)?;
    let displays:Vec<_>=monitors.iter().enumerate().map(|(i,m)|json!({"id":i,"label":m.name(),"width":(m.size().width as f64/m.scale_factor()).round(),"height":(m.size().height as f64/m.scale_factor()).round()})).collect();
    let config = personal();
    let local_port = std::env::var("PUZZLE_INK_LOCAL_PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok());
    let url = local_port
        .map(|port| format!("ws://127.0.0.1:{port}"))
        .unwrap_or_else(|| config["url"].as_str().unwrap().to_owned());
    Ok(
        json!({"url":url,"accessKey":config["accessKey"],"displays":displays,"platform":if cfg!(windows){"win32"}else{"linux"}}),
    )
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command]
async fn overlay_mode(
    app: AppHandle,
    window: WebviewWindow,
    display: usize,
    visible: bool,
    drawing: bool,
) -> Result<()> {
    panel(&window)?;
    if !visible {
        if let Some(w) = app.get_webview_window("overlay") {
            w.hide().map_err(err)?;
        }
        return Ok(());
    }
    let mon = window
        .available_monitors()
        .map_err(err)?
        .into_iter()
        .nth(display)
        .ok_or("Монітор недоступний")?;
    let w = if let Some(w) = app.get_webview_window("overlay") {
        w
    } else {
        WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
            .title("Puzzle Ink Overlay")
            .transparent(true)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .focused(false)
            .focusable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .build()
            .map_err(err)?
    };
    w.set_position(*mon.position()).map_err(err)?;
    w.set_size(*mon.size()).map_err(err)?;
    // GTK creates the GDK window on first show; its input shape needs that handle.
    w.show().map_err(err)?;
    w.set_ignore_cursor_events(!drawing).map_err(err)
}
#[tauri::command]
fn release_overlay(window: WebviewWindow, app: AppHandle) -> Result<()> {
    panel(&window)?;
    if let Some(w) = app.get_webview_window("overlay") {
        w.destroy().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
fn pointer(window: WebviewWindow, display: usize) -> Result<(f64, f64)> {
    panel(&window)?;
    let m = window
        .available_monitors()
        .map_err(err)?
        .into_iter()
        .nth(display)
        .ok_or("Монітор недоступний")?;
    let p = window.cursor_position().map_err(err)?;
    Ok((
        (p.x - m.position().x as f64) / m.scale_factor(),
        (p.y - m.position().y as f64) / m.scale_factor(),
    ))
}
struct Running {
    child: Child,
    stop: watch::Sender<bool>,
    #[cfg(windows)]
    _helper_dir: tempfile::TempDir,
}

#[cfg(windows)]
fn unpack_tunnel() -> std::io::Result<tempfile::TempDir> {
    let dir = tempfile::Builder::new().prefix("PuzzleInk-").tempdir()?;
    let mut output = std::fs::File::create(dir.path().join("cloudflared.exe"))?;
    let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/cloudflared.gz"));
    let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
    std::io::copy(&mut decoder, &mut output)?;
    std::fs::write(
        dir.path().join("LICENSE.cloudflared"),
        include_bytes!("../.runtime/cloudflared/win32/LICENSE.cloudflared"),
    )?;
    Ok(dir)
}

#[cfg(all(test, windows))]
#[test]
fn standalone_tunnel_runs_without_sidecar() {
    let dir = unpack_tunnel().unwrap();
    let helper = dir.path().join("cloudflared.exe");
    let output = Command::new(&helper).arg("--version").output().unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("cloudflared version"));
    drop(dir);
    assert!(!helper.exists());
}
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
struct Host(Mutex<Option<Running>>);
#[tauri::command]
async fn start_host(window: WebviewWindow, host: tauri::State<'_, Host>) -> Result<String> {
    panel(&window)?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8787")
        .await
        .map_err(|_| "Порт 8787 зайнятий. Закрийте попередній сервер.")?;
    #[cfg(windows)]
    let helper_dir = tauri::async_runtime::spawn_blocking(unpack_tunnel)
        .await
        .map_err(err)?
        .map_err(err)?;
    #[cfg(windows)]
    let cloud = helper_dir.path().join("cloudflared.exe");
    #[cfg(not(windows))]
    let cloud = std::env::current_exe()
        .map_err(err)?
        .with_file_name("cloudflared");
    #[cfg(all(target_os = "linux", debug_assertions))]
    let cloud = if cloud.exists() {
        cloud
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(".runtime/cloudflared/linux/cloudflared")
    };
    let p = personal();
    let mut cmd = Command::new(cloud);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let child = cmd
        .args([
            "tunnel",
            "--no-autoupdate",
            "--metrics",
            "127.0.0.1:0",
            "run",
        ])
        .env("TUNNEL_TOKEN", p["tunnelToken"].as_str().unwrap())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let (tx, rx) = watch::channel(false);
    *host.0.lock().unwrap() = Some(Running {
        child,
        stop: tx,
        #[cfg(windows)]
        _helper_dir: helper_dir,
    });
    tauri::async_runtime::spawn(relay::serve(
        listener,
        p["accessKey"].as_str().unwrap().into(),
        id.clone(),
        rx,
    ));
    Ok(id)
}
#[tauri::command]
fn stop_host(window: WebviewWindow, host: tauri::State<Host>) -> Result<()> {
    panel(&window)?;
    host.0.lock().unwrap().take();
    Ok(())
}
#[tauri::command]
fn host_alive(window: WebviewWindow, host: tauri::State<Host>) -> Result<bool> {
    panel(&window)?;
    let mut lock = host.0.lock().unwrap();
    if let Some(host) = lock.as_mut() {
        if host.child.try_wait().map_err(err)?.is_none() {
            return Ok(true);
        }
    }
    lock.take();
    Ok(false)
}
fn main() {
    tauri::Builder::default()
        .manage(Host::default())
        .manage(keys::Keys::default())
        .setup(|app| {
            keys::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|w, e| {
            if w.label() == "panel" && matches!(e, tauri::WindowEvent::Destroyed) {
                w.state::<Host>().0.lock().unwrap().take();
                w.app_handle().exit(0)
            }
        })
        .invoke_handler(tauri::generate_handler![
            startup,
            overlay_mode,
            release_overlay,
            pointer,
            start_host,
            stop_host,
            host_alive,
            keys::set_keys
        ])
        .run(tauri::generate_context!())
        .expect("Puzzle Ink runtime");
}
