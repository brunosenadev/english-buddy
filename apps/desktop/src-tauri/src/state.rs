use rusqlite::Connection;
use serde_json::Value;
use std::sync::Mutex;

pub struct AppState {
    pub client: reqwest::Client,
    pub api_key: String,
    pub db: Connection,
    pub session_id: String,
    pub history: Vec<Value>,
}

pub type SharedState = Mutex<AppState>;
