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
  total_xp INTEGER NOT NULL DEFAULT 0,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_longest INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO user_profile (id) VALUES (1);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password TEXT NOT NULL
);

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

/** Adds a column to an already-existing table if it's not there yet — a
 * lightweight migration path since `CREATE TABLE IF NOT EXISTS` doesn't
 * retroactively add columns to a table that predates this schema version. */
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function initDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  ensureColumn(db, "user_profile", "total_xp", "total_xp INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "user_profile", "streak_current", "streak_current INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "user_profile", "streak_longest", "streak_longest INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "user_profile", "last_active_date", "last_active_date TEXT");
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

export interface ProfileStats {
  level: string;
  estimatedLevel: string | null;
  totalXp: number;
  streakCurrent: number;
  streakLongest: number;
}

export function getProfileStats(db: Database.Database): ProfileStats {
  const row = db
    .prepare(
      "SELECT level, estimated_level, total_xp, streak_current, streak_longest FROM user_profile WHERE id = 1",
    )
    .get() as {
    level: string;
    estimated_level: string | null;
    total_xp: number;
    streak_current: number;
    streak_longest: number;
  };
  return {
    level: row.level,
    estimatedLevel: row.estimated_level,
    totalXp: row.total_xp,
    streakCurrent: row.streak_current,
    streakLongest: row.streak_longest,
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isYesterday(dateStr: string, today: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) === today;
}

/**
 * Awards XP and updates the daily streak for this turn — a streak day is
 * "at least one turn happened," compared against UTC dates (single-user app,
 * timezone edge cases at midnight are an acceptable simplification for now).
 */
export function bumpStreakAndXp(db: Database.Database, xpAwarded: number): { streakCurrent: number; totalXp: number } {
  const row = db
    .prepare("SELECT streak_current, streak_longest, last_active_date, total_xp FROM user_profile WHERE id = 1")
    .get() as { streak_current: number; streak_longest: number; last_active_date: string | null; total_xp: number };

  const today = todayUtc();
  let streakCurrent = row.streak_current;
  if (row.last_active_date === today) {
    // already counted today, leave streak as-is
  } else if (row.last_active_date && isYesterday(row.last_active_date, today)) {
    streakCurrent += 1;
  } else {
    streakCurrent = 1;
  }
  const streakLongest = Math.max(row.streak_longest, streakCurrent);
  const totalXp = row.total_xp + Math.max(0, xpAwarded);

  db.prepare(
    "UPDATE user_profile SET streak_current = ?, streak_longest = ?, last_active_date = ?, total_xp = ?, updated_at = datetime('now') WHERE id = 1",
  ).run(streakCurrent, streakLongest, today, totalXp);

  return { streakCurrent, totalXp };
}

export interface CorrectionEntry {
  timestamp: string;
  original: string;
  corrected: string;
  category: string | null;
}

export function getRecentCorrections(db: Database.Database, limit: number): CorrectionEntry[] {
  const rows = db
    .prepare(
      `SELECT timestamp, correction_original as original, correction_corrected as corrected, correction_error_category as category
       FROM turns WHERE correction_given = 1 ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(limit) as CorrectionEntry[];
  return rows;
}

export function getRecentVocabulary(db: Database.Database, limit: number): string[] {
  const rows = db
    .prepare(
      "SELECT new_vocabulary FROM turns WHERE new_vocabulary IS NOT NULL ORDER BY timestamp DESC LIMIT ?",
    )
    .all(limit) as { new_vocabulary: string }[];

  const seen = new Set<string>();
  const words: string[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.new_vocabulary) as string[];
      for (const word of parsed) {
        if (!seen.has(word)) {
          seen.add(word);
          words.push(word);
        }
      }
    } catch {
      // skip malformed rows
    }
  }
  return words;
}

export function getAppPassword(db: Database.Database): string | null {
  const row = db.prepare("SELECT password FROM app_settings WHERE id = 1").get() as
    | { password: string }
    | undefined;
  return row?.password ?? null;
}

/** Seeds the password from the env var on first boot only — once a row
 * exists (e.g. changed via the UI), the env var is ignored. */
export function seedAppPassword(db: Database.Database, fallback: string): string {
  const existing = getAppPassword(db);
  if (existing) return existing;
  db.prepare("INSERT INTO app_settings (id, password) VALUES (1, ?)").run(fallback);
  return fallback;
}

export function setAppPassword(db: Database.Database, password: string): void {
  db.prepare(
    "INSERT INTO app_settings (id, password) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET password = excluded.password",
  ).run(password);
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
