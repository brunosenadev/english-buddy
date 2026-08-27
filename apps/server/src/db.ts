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

CREATE TABLE IF NOT EXISTS context_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  example_text TEXT,
  context_note TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  times_seen INTEGER NOT NULL DEFAULT 1,
  times_correct_since INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  mastery_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  priority_weight REAL NOT NULL DEFAULT 1.0,
  mnemonic TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_items_review ON context_items (next_review_at) WHERE status = 'active';
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
  ensureColumn(db, "user_profile", "last_activity_type", "last_activity_type TEXT");
  ensureColumn(db, "user_profile", "next_focus_hint", "next_focus_hint TEXT");
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
  streakAtRisk: boolean;
  lastActivityType: string | null;
  nextFocusHint: string | null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getProfileStats(db: Database.Database): ProfileStats {
  const row = db
    .prepare(
      `SELECT level, estimated_level, total_xp, streak_current, streak_longest,
              last_active_date, last_activity_type, next_focus_hint
       FROM user_profile WHERE id = 1`,
    )
    .get() as {
    level: string;
    estimated_level: string | null;
    total_xp: number;
    streak_current: number;
    streak_longest: number;
    last_active_date: string | null;
    last_activity_type: string | null;
    next_focus_hint: string | null;
  };
  return {
    level: row.level,
    estimatedLevel: row.estimated_level,
    totalXp: row.total_xp,
    streakCurrent: row.streak_current,
    streakLongest: row.streak_longest,
    streakAtRisk: row.streak_current > 0 && row.last_active_date !== todayUtc(),
    lastActivityType: row.last_activity_type,
    nextFocusHint: row.next_focus_hint,
  };
}

function isYesterday(dateStr: string, today: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) === today;
}

/**
 * Awards XP, updates the daily streak, and remembers the activity type /
 * next-focus note from this turn — a streak day is "at least one turn
 * happened," compared against UTC dates (single-user app, timezone edge
 * cases at midnight are an acceptable simplification for now).
 */
export function recordTurnOutcome(
  db: Database.Database,
  input: { xpAwarded: number; activityType: string | null; nextFocusHint: string | null },
): { streakCurrent: number; totalXp: number } {
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
  const totalXp = row.total_xp + Math.max(0, input.xpAwarded);

  db.prepare(
    `UPDATE user_profile SET streak_current = ?, streak_longest = ?, last_active_date = ?, total_xp = ?,
     last_activity_type = COALESCE(?, last_activity_type), next_focus_hint = COALESCE(?, next_focus_hint),
     updated_at = datetime('now') WHERE id = 1`,
  ).run(streakCurrent, streakLongest, today, totalXp, input.activityType, input.nextFocusHint);

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

/** Clears the carried-over "what to focus on next" note without touching
 * XP/streak/level — used by /api/reset-conversation so a fresh kickoff
 * doesn't get re-anchored by a note written before the reset. */
export function clearNextFocusHint(db: Database.Database): void {
  db.prepare("UPDATE user_profile SET next_focus_hint = NULL WHERE id = 1").run();
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

function normalizePatternKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Leitner-ish backoff: gets longer each time an item is seen/confirmed
// without a failure, resets to 1 day on any review failure.
const REVIEW_SCHEDULE_DAYS = [1, 3, 7, 14, 30];
function reviewIntervalDays(step: number): number {
  return REVIEW_SCHEDULE_DAYS[Math.min(Math.max(step, 1), REVIEW_SCHEDULE_DAYS.length) - 1];
}
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/**
 * Records that a correction happened this turn — either reinforcing an
 * existing recurring-error item (matched by normalized pattern_key) or
 * creating a new one. This is what actually powers spaced repetition:
 * every correction schedules a future review instead of being logged once
 * and forgotten (which is all `turns` on its own ever did).
 */
export function upsertContextItem(
  db: Database.Database,
  input: { category: string; patternKey: string; exampleText: string | null },
): void {
  const normalized = normalizePatternKey(input.patternKey);
  const existing = db
    .prepare(
      `SELECT id, times_seen FROM context_items WHERE LOWER(TRIM(pattern_key)) = ? AND status != 'archived' LIMIT 1`,
    )
    .get(normalized) as { id: string; times_seen: number } | undefined;

  if (existing) {
    const timesSeen = existing.times_seen + 1;
    db.prepare(
      `UPDATE context_items SET times_seen = ?, last_seen_at = datetime('now'), example_text = ?,
       next_review_at = ?, status = 'active' WHERE id = ?`,
    ).run(timesSeen, input.exampleText, daysFromNow(reviewIntervalDays(timesSeen)), existing.id);
  } else {
    db.prepare(
      `INSERT INTO context_items (id, category, pattern_key, example_text, next_review_at) VALUES (?,?,?,?,?)`,
    ).run(randomUUID(), input.category, input.patternKey, input.exampleText, daysFromNow(reviewIntervalDays(1)));
  }
}

export interface DueReviewItem {
  patternKey: string;
  category: string;
  exampleText: string | null;
  mnemonic: string | null;
  timesSeen: number;
}

/** Items whose scheduled review has come up — ordered so the most
 * persistently-wrong patterns (highest priority_weight) surface first. */
export function getDueReviewItems(db: Database.Database, limit: number): DueReviewItem[] {
  return db
    .prepare(
      `SELECT pattern_key as patternKey, category, example_text as exampleText, mnemonic, times_seen as timesSeen
       FROM context_items
       WHERE status = 'active' AND next_review_at IS NOT NULL AND next_review_at <= datetime('now')
       ORDER BY priority_weight DESC, next_review_at ASC LIMIT ?`,
    )
    .all(limit) as DueReviewItem[];
}

export interface FocusItem {
  patternKey: string;
  timesSeen: number;
  timesCorrectSince: number;
  status: string;
}

/** For the progress screen's "recent focus" section. */
export function getRecentFocusItems(db: Database.Database, limit: number): FocusItem[] {
  return db
    .prepare(
      `SELECT pattern_key as patternKey, times_seen as timesSeen, times_correct_since as timesCorrectSince, status
       FROM context_items ORDER BY last_seen_at DESC LIMIT ?`,
    )
    .all(limit) as FocusItem[];
}

/**
 * Applies the outcome of a deliberate review (the model re-tested a
 * due item and reported whether the user got it right this time).
 * Success pushes the next review further out (Leitner-style) and retires
 * the item once it's been confirmed 3 times in a row; failure snaps the
 * interval back to 1 day and raises priority so it surfaces again sooner.
 */
export function recordReviewOutcome(db: Database.Database, patternKey: string, correct: boolean): void {
  const normalized = normalizePatternKey(patternKey);
  const existing = db
    .prepare(
      `SELECT id, times_correct_since, priority_weight FROM context_items
       WHERE LOWER(TRIM(pattern_key)) = ? AND status = 'active' LIMIT 1`,
    )
    .get(normalized) as { id: string; times_correct_since: number; priority_weight: number } | undefined;
  if (!existing) return;

  if (correct) {
    const timesCorrectSince = existing.times_correct_since + 1;
    const mastered = timesCorrectSince >= 3;
    db.prepare(
      `UPDATE context_items SET times_correct_since = ?, consecutive_failures = 0,
       mastery_score = MIN(1.0, mastery_score + 0.34), status = ?, next_review_at = ?,
       last_seen_at = datetime('now') WHERE id = ?`,
    ).run(
      timesCorrectSince,
      mastered ? "mastered" : "active",
      mastered ? null : daysFromNow(reviewIntervalDays(timesCorrectSince + 1)),
      existing.id,
    );
  } else {
    db.prepare(
      `UPDATE context_items SET consecutive_failures = consecutive_failures + 1,
       priority_weight = MIN(3.0, priority_weight * 1.5), times_correct_since = 0,
       next_review_at = ?, last_seen_at = datetime('now') WHERE id = ?`,
    ).run(daysFromNow(1), existing.id);
  }
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
