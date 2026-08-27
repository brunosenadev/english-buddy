use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// How gently this nudges: starts at 45 minutes between nudges, backs off up
// to 2.5 hours when nudges go unacknowledged, and never fires more than 8
// times in a day regardless of backoff. "Present" means real keyboard/mouse
// activity in the last 2 minutes — we only nudge while the user is actually
// at the machine, never to wake it from being AFK.
const BASE_INTERVAL_MIN: f64 = 45.0;
const MAX_INTERVAL_MIN: f64 = 150.0;
const MAX_DAILY_NUDGES: u32 = 8;
const IDLE_PRESENT_THRESHOLD_SECS: u64 = 120;
const CHECK_INTERVAL_SECS: u64 = 60;

#[derive(Serialize, Deserialize, Clone)]
struct NudgeState {
    last_nudge_unix: Option<u64>,
    backoff_minutes: f64,
    nudges_today: u32,
    day_number: u64,
    awaiting_ack: bool,
}

impl Default for NudgeState {
    fn default() -> Self {
        Self {
            last_nudge_unix: None,
            backoff_minutes: BASE_INTERVAL_MIN,
            nudges_today: 0,
            day_number: current_day_number(),
            awaiting_ack: false,
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn current_day_number() -> u64 {
    now_unix() / 86400
}

fn state_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("nudge_state.json"))
}

fn load_state(app: &AppHandle) -> NudgeState {
    let mut state = state_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<NudgeState>(&s).ok())
        .unwrap_or_default();

    if state.day_number != current_day_number() {
        state.nudges_today = 0;
        state.day_number = current_day_number();
    }
    state
}

fn save_state(app: &AppHandle, state: &NudgeState) {
    if let Some(path) = state_file(app) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = std::fs::write(path, json);
        }
    }
}

#[cfg(windows)]
fn idle_seconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        if GetLastInputInfo(&mut info as *mut LASTINPUTINFO).as_bool() {
            let tick_count = GetTickCount();
            return tick_count.saturating_sub(info.dwTime) as u64 / 1000;
        }
    }
    0
}

#[cfg(not(windows))]
fn idle_seconds() -> u64 {
    0
}

/// Called from the frontend when a nudge actually gets clicked into a chat
/// open — resets the backoff to the base interval, since responding to a
/// nudge is the "it worked" signal, not just showing it.
#[tauri::command]
pub fn nudge_acknowledged(app: AppHandle) {
    let mut state = load_state(&app);
    if state.awaiting_ack {
        state.backoff_minutes = BASE_INTERVAL_MIN;
        state.awaiting_ack = false;
        save_state(&app, &state);
    }
}

fn maybe_nudge(app: &AppHandle) {
    let mut state = load_state(app);

    if state.nudges_today >= MAX_DAILY_NUDGES {
        return;
    }
    if idle_seconds() >= IDLE_PRESENT_THRESHOLD_SECS {
        return; // not actually at the machine right now
    }

    let elapsed_min = state
        .last_nudge_unix
        .map(|t| (now_unix().saturating_sub(t)) as f64 / 60.0)
        .unwrap_or(f64::MAX);

    if elapsed_min < state.backoff_minutes {
        return;
    }

    // Firing again without the previous one ever being acknowledged is the
    // "he's ignoring this" signal — ease off harder next time.
    if state.awaiting_ack {
        state.backoff_minutes = (state.backoff_minutes * 1.6).min(MAX_INTERVAL_MIN);
    }

    state.last_nudge_unix = Some(now_unix());
    state.nudges_today += 1;
    state.awaiting_ack = true;
    save_state(app, &state);

    let _ = app.emit("eb://nudge", ());
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(CHECK_INTERVAL_SECS));
        loop {
            interval.tick().await;
            maybe_nudge(&app);
        }
    });
}
