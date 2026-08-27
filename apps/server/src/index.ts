import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth.js";
import { MODEL_HAIKU, streamTurn } from "./claude.js";
import {
  clearNextFocusHint,
  countTurns,
  getProfileStats,
  getRecentCorrections,
  getRecentVocabulary,
  initDb,
  insertTurn,
  loadHistory,
  newSession,
  recordTurnOutcome,
  saveHistory,
  seedAppPassword,
  setAppPassword,
  updateProfileLevel,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 8787;
const APP_PASSWORD = process.env.APP_PASSWORD;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const DB_PATH = process.env.DB_PATH || "./data/english_buddy.db";

if (!APP_PASSWORD) {
  console.error("APP_PASSWORD is not set — refusing to start.");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.warn("warning: ANTHROPIC_API_KEY is not set — chat requests will fail");
}

const db = initDb(DB_PATH);
const sessionId = newSession(db);
let history: Anthropic.MessageParam[] = loadHistory(db) as Anthropic.MessageParam[];
let currentPassword = seedAppPassword(db, APP_PASSWORD);

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const auth = requireAuth(() => currentPassword);

const app = express();
// The desktop app is a Tauri webview on a different origin than the PWA
// (which is same-origin). Every route here is already behind the bearer
// password check, so a permissive CORS policy adds no real exposure.
app.use(cors());
app.use(express.json());

// A synthetic first "user" turn used to kick off a brand-new conversation —
// the Messages API needs a user turn to respond to, but this one is an
// instruction, not something the human said, so /api/history filters it out.
const KICKOFF_MARKER = "[[SYSTEM_KICKOFF]]";
const KICKOFF_INSTRUCTION = `${KICKOFF_MARKER} This is literally the first time you're meeting him — no prior context exists. Greet him warmly and briefly, mostly in Portuguese (you don't know his level yet, so default to heavy Portuguese here per your language balance rules). In this first message: (1) a one-line warm greeting, (2) one short line explaining how this works — quick English practice woven into his day, you lead, he just responds, no menus, (3) ask what he works with day to day (role/stack) so future examples are relevant, and (4) end with one very short, easy English prompt so he produces something immediately. Keep it brief — this is a first impression, not a lecture.`;

function isVisibleText(text: string): boolean {
  return text.length > 0 && !text.startsWith(KICKOFF_MARKER);
}

// Serializes every read-modify-write of the shared `history`/DB state.
// Now that desktop and the PWA hit the same backend concurrently (the whole
// point of the unification), two in-flight turns reading the same `history`
// before either writes back would silently drop one of them — this makes
// them queue instead of race.
let historyLock: Promise<unknown> = Promise.resolve();
function withHistoryLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = historyLock.then(fn, fn);
  historyLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** A per-turn nudge on top of the system prompt's language-balance rule —
 * repeating it fresh right before generation measurably improves how often
 * the model actually follows it, versus relying on the system prompt alone. */
function languageReminder(level: string): string {
  const l = level.toUpperCase();
  if (l.startsWith("A")) {
    return "Reminder: explain almost everything in Portuguese this turn — only the target English sentence/prompt should be in English.";
  }
  if (l.startsWith("B1")) {
    return "Reminder: keep explanations and instructions mostly in Portuguese this turn. English is only for the practice sentence/prompt itself and a few simple recurring phrases.";
  }
  if (l.startsWith("B2")) {
    return "Reminder: explanations can be mostly English now, dropping to Portuguese only for a genuinely tricky nuance.";
  }
  if (l.startsWith("C")) {
    return "Reminder: full English is fine now — Portuguese only if he seems truly stuck.";
  }
  return "Reminder: when unsure, default to Portuguese for explanations — only the target English sentence/prompt should be in English.";
}

app.get("/api/session", auth, (_req, res) => {
  const stats = getProfileStats(db);
  res.json({
    ok: true,
    level: stats.estimatedLevel ?? stats.level,
    turnCount: countTurns(db),
    totalXp: stats.totalXp,
    streakCurrent: stats.streakCurrent,
    streakLongest: stats.streakLongest,
    streakAtRisk: stats.streakAtRisk,
    lastActivityType: stats.lastActivityType,
    hasHistory: history.length > 0,
  });
});

app.get("/api/history", auth, (_req, res) => {
  const messages: { id: number; from: "ai" | "user"; text: string }[] = [];
  let id = 1;
  for (const message of history) {
    if (typeof message.content === "string") continue;
    const text = message.content
      .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!isVisibleText(text)) continue;
    messages.push({ id: id++, from: message.role === "assistant" ? "ai" : "user", text });
  }
  res.json({ messages });
});

app.get("/api/progress", auth, (_req, res) => {
  const stats = getProfileStats(db);
  res.json({
    level: stats.estimatedLevel ?? stats.level,
    totalXp: stats.totalXp,
    streakCurrent: stats.streakCurrent,
    streakLongest: stats.streakLongest,
    corrections: getRecentCorrections(db, 20),
    vocabulary: getRecentVocabulary(db, 50),
  });
});

// Wipes the conversation context (not XP/streak/turn history) so the next
// message starts a brand-new kickoff — useful when switching topics entirely,
// or after a pedagogy change like this one where old context anchors style.
app.post("/api/reset-conversation", auth, async (_req, res) => {
  await withHistoryLock(() => {
    history = [];
    saveHistory(db, history);
    // Otherwise the very next (kickoff) turn would re-inject a focus note
    // written before the reset, undermining the reason for resetting.
    clearNextFocusHint(db);
  });
  res.json({ ok: true });
});

app.post("/api/change-password", auth, (req, res) => {
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
  if (!newPassword || newPassword.length < 4) {
    res.status(400).json({ error: "newPassword must be at least 4 characters" });
    return;
  }
  setAppPassword(db, newPassword);
  currentPassword = newPassword;
  res.json({ ok: true });
});

/**
 * Runs one turn: sends `userText` (plus history) to Claude, streams the
 * reply, persists everything, and reports back XP/streak/activity state.
 * Shared by /api/chat (real user text) and /api/kickoff (a synthetic first
 * turn) so both paths update history/db/streak identically. Callers must
 * already hold `historyLock` — this function doesn't acquire it itself so
 * that /api/kickoff can check-and-run atomically under one lock.
 */
async function runTurnUnlocked(userText: string, res: express.Response): Promise<void> {
  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);

  const stats = getProfileStats(db);
  const turnCount = countTurns(db);
  const levelDisplay = stats.estimatedLevel ?? stats.level;
  const focusNote = stats.nextFocusHint
    ? ` Your own note from last time on what to focus on next: "${stats.nextFocusHint}" — use it if it still fits, but follow the conversation if it naturally goes elsewhere.`
    : "";
  const contextBlock = `Context for this turn — not part of the conversation, never quote it back: total turns so far is ${turnCount}. Current estimated level: ${levelDisplay}${
    turnCount < 15 ? " (still calibrating — few data points so far, treat as a rough default)" : ""
  }.${focusNote} ${languageReminder(levelDisplay)}`;

  const nextHistory: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: [{ type: "text", text: userText }] },
  ];

  try {
    const outcome = await streamTurn(client, MODEL_HAIKU, nextHistory, contextBlock, (delta) => {
      send({ type: "delta", text: delta });
    });

    nextHistory.push({
      role: "assistant",
      content: outcome.assistantContent as Anthropic.ContentBlockParam[],
    });
    if (outcome.toolUseId) {
      nextHistory.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: outcome.toolUseId, content: "logged" },
        ] as unknown as Anthropic.ContentBlockParam[],
      });
    }

    history = nextHistory;
    saveHistory(db, history);
    insertTurn(db, sessionId, outcome.fullText, outcome.logTurn);
    if (outcome.logTurn?.estimated_level) {
      updateProfileLevel(db, outcome.logTurn.estimated_level);
    }
    const xpAwarded = outcome.logTurn?.xp_awarded ?? 0;
    const { streakCurrent, totalXp } = recordTurnOutcome(db, {
      xpAwarded,
      activityType: outcome.logTurn?.activity_type ?? null,
      nextFocusHint: outcome.logTurn?.next_focus_hint ?? null,
    });

    send({
      type: "done",
      xpAwarded,
      activityClosed: outcome.logTurn?.activity_closed ?? false,
      activityType: outcome.logTurn?.activity_type ?? null,
      streakCurrent,
      totalXp,
    });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
}

app.post("/api/chat", auth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  await withHistoryLock(() => runTurnUnlocked(text, res));
});

// Kicks off a brand-new conversation with a real, model-generated opening
// instead of a hardcoded line — a no-op if the user already has history.
// The has-history check and the turn itself run under one lock acquisition
// so two concurrent kickoff calls (e.g. two devices opening at once) can't
// both see "empty" and both inject a greeting into the same conversation.
app.post("/api/kickoff", auth, async (_req, res) => {
  await withHistoryLock(() => {
    if (history.length > 0) {
      const stats = getProfileStats(db);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(
        `${JSON.stringify({
          type: "done",
          xpAwarded: 0,
          activityClosed: false,
          activityType: stats.lastActivityType,
          streakCurrent: stats.streakCurrent,
          totalXp: stats.totalXp,
        })}\n`,
      );
      res.end();
      return;
    }
    return runTurnUnlocked(KICKOFF_INSTRUCTION, res);
  });
});

const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  console.warn(`warning: ${webDist} not found — run "npm run build --workspace=apps/web" to serve the PWA`);
}

app.listen(PORT, () => {
  console.log(`English Buddy server listening on :${PORT}`);
});
