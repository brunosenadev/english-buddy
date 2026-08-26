import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth.js";
import { MODEL_HAIKU, streamTurn } from "./claude.js";
import {
  countTurns,
  getProfileLevel,
  initDb,
  insertTurn,
  loadHistory,
  newSession,
  saveHistory,
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

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const auth = requireAuth(APP_PASSWORD);

const app = express();
app.use(express.json());

app.get("/api/session", auth, (_req, res) => {
  const { level, estimatedLevel } = getProfileLevel(db);
  res.json({ ok: true, level: estimatedLevel ?? level, turnCount: countTurns(db) });
});

app.post("/api/chat", auth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);

  const { level, estimatedLevel } = getProfileLevel(db);
  const turnCount = countTurns(db);
  const levelDisplay = estimatedLevel ?? level;
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

    send({
      type: "done",
      xpAwarded: outcome.logTurn?.xp_awarded ?? 0,
      activityClosed: outcome.logTurn?.activity_closed ?? false,
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
