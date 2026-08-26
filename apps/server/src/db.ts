import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LogTurnInput } from "@english-buddy/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  level TEXT NOT NULL DEFAULT 'B1',
  estimated_level TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO user_profile (id) VALUES (1);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  next_focus_hint TEXT
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, timestamp);

CREATE TABLE IF NOT EXISTS conversation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_json TEXT NOT NULL DEFAULT '[]'
);
INSERT OR IGNORE INTO conversation_state (id) VALUES (1);
`;

export function initDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function newSession(db: Database.Database): string {
  const id = randomUUID();
  db.prepare("INSERT INTO sessions (id) VALUES (?)").run(id);
  return id;
}

export function getProfileLevel(db: Database.Database): {
  level: string;
  estimatedLevel: string | null;
} {
  const row = db
    .prepare("SELECT level, estimated_level FROM user_profile WHERE id = 1")
    .get() as { level: string; estimated_level: string | null };
  return { level: row.level, estimatedLevel: row.estimated_level };
}

export function updateProfileLevel(db: Database.Database, level: string): void {
  db.prepare(
    "UPDATE user_profile SET level = ?, estimated_level = ?, updated_at = datetime('now') WHERE id = 1",
  ).run(level, level);
}

export function countTurns(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as n FROM turns").get() as { n: number };
  return row.n;
}

export function insertTurn(
  db: Database.Database,
  sessionId: string,
  text: string,
  log: LogTurnInput | null,
): void {
  db.prepare(
    `INSERT INTO turns (
      id, session_id, role, text, activity_type, xp_awarded,
      correction_given, correction_original, correction_corrected,
      correction_error_category, new_vocabulary, activity_closed, next_focus_hint
    ) VALUES (?,?,'assistant',?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    randomUUID(),
    sessionId,
    text,
    log?.activity_type ?? null,
    log?.xp_awarded ?? 0,
    log?.correction_given ? 1 : 0,
    log?.correction_detail?.original ?? null,
    log?.correction_detail?.corrected ?? null,
    log?.correction_detail?.error_category ?? null,
    log?.new_vocabulary ? JSON.stringify(log.new_vocabulary) : null,
    log?.activity_closed ? 1 : 0,
    log?.next_focus_hint ?? null,
  );
}

export function loadHistory(db: Database.Database): unknown[] {
  const row = db
    .prepare("SELECT history_json FROM conversation_state WHERE id = 1")
    .get() as { history_json: string };
  try {
    return JSON.parse(row.history_json);
  } catch {
    return [];
  }
}

export function saveHistory(db: Database.Database, history: unknown[]): void {
  db.prepare("UPDATE conversation_state SET history_json = ? WHERE id = 1").run(
    JSON.stringify(history),
  );
}
