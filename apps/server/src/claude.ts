import Anthropic from "@anthropic-ai/sdk";
import type { LogTurnInput } from "@english-buddy/shared";

export const MODEL_HAIKU = "claude-haiku-4-5";
export const MODEL_SONNET = "claude-sonnet-5";

// Ported verbatim from apps/desktop/src-tauri/src/claude/mod.rs — this is the
// persona/pedagogy definition, not Rust-specific, so both clients share it.
export const SYSTEM_PROMPT = `You are English Buddy — a warm, direct English-speaking friend and personal trainer helping a Brazilian software developer become fluent through short, everyday practice woven into his workday. You are not a translator and not a formal course.

Core behavior:
- YOU are in charge of what happens next. Never ask the user what he wants to do, never present a menu of options ("would you like to practice X or Y?", "what should we work on?"). Decide yourself — pick a topic, a challenge, a question — and just go. He should never have to manage his own lesson plan; that is your job, like a real teacher who walks in with a plan instead of asking the student what today's class should be about.
- The practice itself — your questions, prompts, corrected sentences, and examples — always stays in English. This is non-negotiable: producing English is the entire point, so never translate the actual practice material into Portuguese.
- However, when you explain a grammar RULE or name a grammatical pattern or structure (meta-language about English, not the English itself), you should keep it simple and, if a short Portuguese gloss would make the rule click, add one in parentheses. He is not an advanced student, doesn't study outside these chats, and jargon like "pattern" or "structure" can lose him as easily in Portuguese as in English — so favor plain words, and use Portuguese as a tool for clarity on the RULE, never as a shortcut that lets him skip producing English.
- If the user doesn't know a word, help him arrive at it through circumlocution instead of just handing him the translation.
- Correct at most 1-2 mistakes per reply. Never produce a long list of corrections.
- Every correction must be immediately followed by asking the user to actively reproduce the corrected structure in a new sentence of his own — never just state the correction and move on to something unrelated.
- When re-testing a mistake the user has made before, use a new sentence or context — never repeat the exact original sentence back to him.
- End every reply, unless you are deliberately closing the current activity, with a question or prompt that pushes the user to produce more English.
- Keep the tone like a real teacher-friend: direct, encouraging, a little informal, never robotic, never childish.

Bookkeeping (invisible to the user):
After every reply, call the log_turn tool exactly once to silently record what happened this turn — never mention this tool or its contents to the user. Be honest in it: only set correction_given=true if you actually corrected something in this exact reply, and fill correction_detail with the original and corrected text when you do. Award xp_awarded based on effort and engagement (roughly 5-15 for a normal exchange, more when a full activity wraps up). Set activity_closed=true only when the current exercise or topic is genuinely wrapping up.

Level calibration: the current turn count and your best current guess of his level are given to you as context below the practice starts. There was no onboarding quiz — you build this estimate purely from how he actually writes (error density, sentence complexity, vocabulary range). Only set estimated_level in log_turn when you're revising or confidently confirming your read on him (a CEFR label like "A2", "B1", "B1+", "B2") — leave it out most turns. Don't ask him what his level is and don't mention that you're assessing him.`;

export function logTurnToolDef() {
  return {
    name: "log_turn",
    description:
      "Silently record what happened this turn: whether a correction was given, XP earned, and whether the current activity is closed. Call this exactly once on every reply. Never mention it to the user.",
    input_schema: {
      type: "object",
      properties: {
        activity_type: {
          type: "string",
          enum: [
            "free_conversation",
            "quick_challenge",
            "sentence_correction",
            "fill_blank",
            "vocabulary",
            "grammar_drill",
            "tech_context",
            "meeting_simulation",
            "interview_simulation",
            "explain_topic",
            "rewrite_natural",
            "error_review",
          ],
        },
        correction_given: { type: "boolean" },
        correction_detail: {
          type: ["object", "null"],
          properties: {
            original: { type: "string" },
            corrected: { type: "string" },
            error_category: { type: "string" },
          },
        },
        new_vocabulary: {
          type: ["array", "null"],
          items: { type: "string" },
        },
        xp_awarded: { type: "integer" },
        activity_closed: { type: "boolean" },
        next_focus_hint: { type: ["string", "null"] },
        estimated_level: {
          type: ["string", "null"],
          description:
            "Only set when revising or confidently confirming your read of his CEFR level, e.g. 'A2', 'B1', 'B1+', 'B2'. Omit most turns.",
        },
      },
      required: ["activity_type", "correction_given", "xp_awarded", "activity_closed"],
    },
  };
}

export interface TurnOutcome {
  fullText: string;
  logTurn: LogTurnInput | null;
  assistantContent: unknown[];
  toolUseId: string | null;
}

/**
 * Sends the conversation to Claude with streaming enabled, forwarding text
 * deltas via `onDelta` as they arrive, and returns the accumulated `log_turn`
 * tool call once the response is complete. Mirrors `stream_turn` in
 * claude/mod.rs, but leans on the SDK's own SSE handling instead of a
 * hand-rolled parser.
 */
export async function streamTurn(
  client: Anthropic,
  model: string,
  messages: Anthropic.MessageParam[],
  contextBlock: string,
  onDelta: (text: string) => void,
): Promise<TurnOutcome> {
  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: contextBlock },
    ],
    tools: [logTurnToolDef() as Anthropic.Tool],
    messages,
  });

  stream.on("text", (text) => onDelta(text));

  const finalMessage = await stream.finalMessage();

  let fullText = "";
  let toolUseId: string | null = null;
  let logTurn: LogTurnInput | null = null;
  const assistantContent: unknown[] = [];

  for (const block of finalMessage.content) {
    if (block.type === "text") {
      fullText += block.text;
      assistantContent.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && block.name === "log_turn") {
      toolUseId = block.id;
      logTurn = block.input as LogTurnInput;
      assistantContent.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
  }

  return { fullText, logTurn, assistantContent, toolUseId };
}
