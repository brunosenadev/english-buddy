use rusqlite::Connection;
use std::fs;
use tauri::Manager;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  level TEXT NOT NULL DEFAULT 'B1',
  total_xp INTEGER NOT NULL DEFAULT 0,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_longest INTEGER NOT NULL DEFAULT 0,
  estimated_level TEXT,
  activity_affinity TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  supabase_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);
INSERT OR IGNORE INTO user_profile (id) VALUES (1);

CREATE TABLE IF NOT EXISTS user_context_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('grammar_error','vocabulary_gap','topic_practiced','general_note')),
  pattern_key TEXT NOT NULL,
  example_text TEXT,
  context_note TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  times_seen INTEGER NOT NULL DEFAULT 1,
  times_correct_since INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  mastery_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','archived')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  priority_weight REAL NOT NULL DEFAULT 1.0,
  mnemonic TEXT,
  supabase_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_items_review ON user_context_items (next_review_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_context_items_pattern ON user_context_items (pattern_key);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  supabase_id TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  activity_type TEXT,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  correction_given INTEGER NOT NULL DEFAULT 0,
  correction_original TEXT,
  correction_corrected TEXT,
  correction_error_category TEXT,
  new_vocabulary TEXT,
  activity_closed INTEGER NOT NULL DEFAULT 0,
  next_focus_hint TEXT,
  linked_context_item_ids TEXT,
  supabase_id TEXT,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, timestamp);

CREATE TABLE IF NOT EXISTS daily_progress (
  date TEXT PRIMARY KEY,
  xp_total INTEGER NOT NULL DEFAULT 0,
  streak_count INTEGER NOT NULL DEFAULT 0,
  checklist_conversation INTEGER NOT NULL DEFAULT 0,
  checklist_vocabulary INTEGER NOT NULL DEFAULT 0,
  checklist_grammar INTEGER NOT NULL DEFAULT 0,
  checklist_daily_challenge INTEGER NOT NULL DEFAULT 0,
  practice_minutes INTEGER NOT NULL DEFAULT 0,
  supabase_id TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
"#;

pub fn init_db(app: &tauri::AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should resolve");
    fs::create_dir_all(&dir).expect("should be able to create app data dir");
    let conn = Connection::open(dir.join("english_buddy.db"))?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn new_session(conn: &Connection) -> rusqlite::Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute("INSERT INTO sessions (id) VALUES (?1)", [&id])?;
    Ok(id)
}

/// (level, estimated_level) — `level` is the confirmed/default label,
/// `estimated_level` is the live in-progress read (may be null early on).
pub fn get_profile_level(conn: &Connection) -> rusqlite::Result<(String, Option<String>)> {
    conn.query_row(
        "SELECT level, estimated_level FROM user_profile WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

pub fn update_profile_level(conn: &Connection, level: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE user_profile SET level = ?1, estimated_level = ?1, updated_at = datetime('now') WHERE id = 1",
        [level],
    )?;
    Ok(())
}

pub fn count_turns(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM turns", [], |row| row.get(0))
}
