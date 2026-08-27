use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{Manager, PhysicalPosition, WindowEvent};

#[derive(Serialize, Deserialize)]
struct SavedPosition {
    x: i32,
    y: i32,
}

fn position_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("bubble_position.json"))
}

fn load_saved_position(app: &tauri::AppHandle) -> Option<PhysicalPosition<i32>> {
    let path = position_file(app)?;
    let contents = fs::read_to_string(path).ok()?;
    let saved: SavedPosition = serde_json::from_str(&contents).ok()?;
    Some(PhysicalPosition::new(saved.x, saved.y))
}

fn save_position(app: &tauri::AppHandle, pos: PhysicalPosition<i32>) {
    let Some(path) = position_file(app) else {
        return;
    };
    let saved = SavedPosition { x: pos.x, y: pos.y };
    if let Ok(json) = serde_json::to_string(&saved) {
        let _ = fs::write(path, json);
    }
}

/// Bottom-right corner of the primary monitor. `monitor.size()` is the full
/// monitor resolution (Tauri has no cross-platform "work area" excluding the
/// taskbar), so we use a generous bottom margin as a rough heuristic to
/// clear the Windows taskbar.
fn default_corner_position(window: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window.current_monitor().ok()??;
    let window_size = window.outer_size().ok()?;

    let scale = monitor.scale_factor();
    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();

    let margin_x = (32.0 * scale) as i32;
    let margin_bottom = (96.0 * scale) as i32;

    let x = monitor_pos.x + monitor_size.width as i32 - window_size.width as i32 - margin_x;
    let y = monitor_pos.y + monitor_size.height as i32 - window_size.height as i32 - margin_bottom;

    Some(PhysicalPosition::new(x, y))
}

/// Restores the bubble to wherever the user last dragged it, falling back
/// to the bottom-right corner on first run.
fn position_bubble(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("bubble") else {
        return;
    };

    let position = load_saved_position(app).or_else(|| default_corner_position(&window));
    if let Some(position) = position {
        let _ = window.set_position(position);
    }
}

/// Shows/hides the chat popover, anchoring it above the bubble's current
/// position (right edges aligned, small gap above the bubble) each time it
/// opens — so it follows the bubble even after it's been dragged.
#[tauri::command]
fn toggle_chat_window(app: tauri::AppHandle) {
    let (Some(bubble), Some(chat)) = (
        app.get_webview_window("bubble"),
        app.get_webview_window("chat"),
    ) else {
        return;
    };

    if chat.is_visible().unwrap_or(false) {
        let _ = chat.hide();
        return;
    }

    if let (Ok(bubble_pos), Ok(bubble_size), Ok(chat_size)) = (
        bubble.outer_position(),
        bubble.outer_size(),
        chat.outer_size(),
    ) {
        let scale = bubble.scale_factor().unwrap_or(1.0);
        let gap = (12.0 * scale) as i32;

        let x = bubble_pos.x + bubble_size.width as i32 - chat_size.width as i32;
        let y = bubble_pos.y - chat_size.height as i32 - gap;

        let _ = chat.set_position(PhysicalPosition::new(x, y));
    }

    let _ = chat.show();
    let _ = chat.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![toggle_chat_window])
        .setup(|app| {
            position_bubble(app.handle());

            if let Some(window) = app.get_webview_window("bubble") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Moved(position) = event {
                        save_position(&app_handle, *position);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
