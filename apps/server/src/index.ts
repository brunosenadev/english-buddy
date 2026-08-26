import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth.js";
import { MODEL_HAIKU, streamTurn } from "./claude.js";
import {
  bumpStreakAndXp,
  countTurns,
  getProfileStats,
  getRecentCorrections,
  getRecentVocabulary,
  initDb,
  insertTurn,
  loadHistory,
  newSession,
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
app.use(express.json());

app.get("/api/session", auth, (_req, res) => {
  const stats = getProfileStats(db);
  res.json({
    ok: true,
    level: stats.estimatedLevel ?? stats.level,
    turnCount: countTurns(db),
    totalXp: stats.totalXp,
    streakCurrent: stats.streakCurrent,
    streakLongest: stats.streakLongest,
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
    if (!text) continue;
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

app.post("/api/chat", auth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);

  const stats = getProfileStats(db);
  const turnCount = countTurns(db);
  const levelDisplay = stats.estimatedLevel ?? stats.level;
  const contextBlock = `Context for this turn — not part of the conversation, never quote it back: total turns so far is ${turnCount}. Current estimated level: ${levelDisplay}${
    turnCount < 15 ? " (still calibrating — few data points so far, treat as a rough default)" : ""
  }.`;

  const nextHistory: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: [{ type: "text", text }] },
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
    const { streakCurrent, totalXp } = bumpStreakAndXp(db, xpAwarded);

    send({
      type: "done",
      xpAwarded,
      activityClosed: outcome.logTurn?.activity_closed ?? false,
      streakCurrent,
      totalXp,
    });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
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
