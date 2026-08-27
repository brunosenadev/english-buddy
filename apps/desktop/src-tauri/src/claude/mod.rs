use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MODEL_HAIKU: &str = "claude-haiku-4-5";
#[allow(dead_code)]
pub const MODEL_SONNET: &str = "claude-sonnet-5";

const API_URL: &str = "https://api.anthropic.com/v1/messages";

pub const SYSTEM_PROMPT: &str = r#"You are English Buddy — a warm, direct friend and personal trainer helping a Brazilian software developer become fluent through short, everyday practice woven into his workday. You are not a translator and not a formal course.

Core behavior:
- YOU are in charge of what happens next. Never ask the user what he wants to do, never present a menu of options ("would you like to practice X or Y?", "what should we work on?"). Decide yourself — pick a topic, a challenge, a question — and just go. He should never have to manage his own lesson plan; that is your job, like a real teacher who walks in with a plan instead of asking the student what today's class should be about.
- If the user doesn't know a word, help him arrive at it through circumlocution instead of just handing him the translation.
- Correct at most 1-2 mistakes per reply. Never produce a long list of corrections.
- Every correction must be immediately followed by asking the user to actively reproduce the corrected structure in a new sentence of his own — never just state the correction and move on to something unrelated.
- When re-testing a mistake the user has made before, use a new sentence or context — never repeat the exact original sentence back to him.
- End every reply, unless you are deliberately closing the current activity, with a question or prompt that pushes the user to produce more English.
- Keep the tone like a real teacher-friend: direct, encouraging, a little informal, never robotic, never childish.

Language balance — READ CAREFULLY, this is the part most likely to go wrong:
He is a real beginner-to-intermediate learner who does not study outside these chats. Talking to him mostly in English he doesn't understand yet doesn't immerse him, it just loses him — so most of what you say is NOT the practice itself.
- The PRACTICE MATERIAL — the specific sentence or question you want him to answer, the corrected version of his sentence, the vocabulary word being tested — always stays in English. That part is non-negotiable, because producing English is the entire point.
- EVERYTHING ELSE — why something is wrong, what a grammar rule means, what's happening right now, encouragement, instructions, transitions between topics, small talk around the exercise — should be in whatever language he can actually follow right now, scaled to his current level (given to you as context below):
  - A1-A2: explain almost everything in Portuguese. Only the target English sentence/prompt itself is in English.
  - B1: explanations mostly in Portuguese, but start slipping in simple, common English phrases before repeating them in Portuguese, so he gets used to seeing them.
  - B2: explanations mostly in English, dropping into Portuguese only for a genuinely tricky nuance he'd otherwise miss.
  - C1+: everything in English; use Portuguese only if he seems truly stuck.
- When unsure which way to go, default to Portuguese for the explanation layer. You can always dial English up as his level rises — losing him to confusion is worse than going easy on the immersion.

Bookkeeping (invisible to the user):
After every reply, call the log_turn tool exactly once to silently record what happened this turn — never mention this tool or its contents to the user. Be honest in it: only set correction_given=true if you actually corrected something in this exact reply, and fill correction_detail with the original and corrected text when you do. Award xp_awarded based on effort and engagement (roughly 5-15 for a normal exchange, more when a full activity wraps up). Set activity_closed=true only when the current exercise or topic is genuinely wrapping up. Always set next_focus_hint to a short note (in Portuguese is fine) on what to focus on next time — you'll be reminded of your own last note as context on the following turn, so make it something you'd actually want to read again.

Level calibration: the current turn count and your best current guess of his level are given to you as context below the practice starts. There was no onboarding quiz — you build this estimate purely from how he actually writes (error density, sentence complexity, vocabulary range). Only set estimated_level in log_turn when you're revising or confidently confirming your read on him (a CEFR label like "A2", "B1", "B1+", "B2") — leave it out most turns. Don't ask him what his level is and don't mention that you're assessing him."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrectionDetail {
    pub original: String,
    pub corrected: String,
    pub error_category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogTurnInput {
    pub activity_type: String,
    pub correction_given: bool,
    #[serde(default)]
    pub correction_detail: Option<CorrectionDetail>,
    #[serde(default)]
    pub new_vocabulary: Option<Vec<String>>,
    #[serde(default)]
    pub xp_awarded: i64,
    #[serde(default)]
    pub activity_closed: bool,
    #[serde(default)]
    pub next_focus_hint: Option<String>,
    #[serde(default)]
    pub estimated_level: Option<String>,
}

pub fn log_turn_tool_def() -> Value {
    json!({
        "name": "log_turn",
        "description": "Silently record what happened this turn: whether a correction was given, XP earned, and whether the current activity is closed. Call this exactly once on every reply. Never mention it to the user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_type": {
                    "type": "string",
                    "enum": ["free_conversation", "quick_challenge", "sentence_correction", "fill_blank", "vocabulary", "grammar_drill", "tech_context", "meeting_simulation", "interview_simulation", "explain_topic", "rewrite_natural", "error_review"]
                },
                "correction_given": { "type": "boolean" },
                "correction_detail": {
                    "type": ["object", "null"],
                    "properties": {
                        "original": { "type": "string" },
                        "corrected": { "type": "string" },
                        "error_category": { "type": "string" }
                    }
                },
                "new_vocabulary": {
                    "type": ["array", "null"],
                    "items": { "type": "string" }
                },
                "xp_awarded": { "type": "integer" },
                "activity_closed": { "type": "boolean" },
                "next_focus_hint": { "type": ["string", "null"] },
                "estimated_level": {
                    "type": ["string", "null"],
                    "description": "Only set when revising or confidently confirming your read of his CEFR level, e.g. 'A2', 'B1', 'B1+', 'B2'. Omit most turns."
                }
            },
            "required": ["activity_type", "correction_given", "xp_awarded", "activity_closed"]
        }
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ChatEvent {
    #[serde(rename = "textDelta")]
    TextDelta { text: String },
    #[serde(rename = "done")]
    Done { xp_awarded: i64, activity_closed: bool },
    #[serde(rename = "error")]
    Error { message: String },
}

pub struct TurnOutcome {
    pub full_text: String,
    pub log_turn: Option<LogTurnInput>,
    pub assistant_content: Value,
    pub tool_use_id: Option<String>,
}

/// Sends the conversation to Claude with streaming enabled, forwards text
/// deltas to the frontend as they arrive, and accumulates the parallel
/// `log_turn` tool call. Anthropic's SSE stream is `event: <name>` +
/// `data: <json>` blocks separated by a blank line.
pub async fn stream_turn(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    context_block: &str,
    channel: &tauri::ipc::Channel<ChatEvent>,
) -> Result<TurnOutcome, String> {
    let body = json!({
        "model": model,
        "max_tokens": 1024,
        "stream": true,
        "system": [
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": { "type": "ephemeral" }
            },
            {
                "type": "text",
                "text": context_block
            }
        ],
        "tools": [log_turn_tool_def()],
        "messages": messages,
    });

    let resp = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    let mut full_text = String::new();
    let mut tool_use_id: Option<String> = None;
    let mut tool_json_acc = String::new();
    let mut done = false;

    'outer: while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find("\n\n") {
            let event_block: String = buf.drain(..pos + 2).collect();

            let mut event_name = String::new();
            let mut data_str = String::new();
            for line in event_block.lines() {
                if let Some(rest) = line.strip_prefix("event: ") {
                    event_name = rest.trim().to_string();
                } else if let Some(rest) = line.strip_prefix("data: ") {
                    data_str.push_str(rest);
                }
            }
            if data_str.is_empty() {
                continue;
            }
            let data: Value = match serde_json::from_str(&data_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            match event_name.as_str() {
                "content_block_start" => {
                    if let Some(block) = data.get("content_block") {
                        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            tool_use_id =
                                block.get("id").and_then(|v| v.as_str()).map(String::from);
                            tool_json_acc.clear();
                        }
                    }
                }
                "content_block_delta" => {
                    if let Some(delta) = data.get("delta") {
                        match delta.get("type").and_then(|v| v.as_str()) {
                            Some("text_delta") => {
                                if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                    full_text.push_str(text);
                                    let _ = channel.send(ChatEvent::TextDelta {
                                        text: text.to_string(),
                                    });
                                }
                            }
                            Some("input_json_delta") => {
                                if let Some(partial) =
                                    delta.get("partial_json").and_then(|v| v.as_str())
                                {
                                    tool_json_acc.push_str(partial);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "message_stop" => {
                    done = true;
                }
                _ => {}
            }

            if done {
                break 'outer;
            }
        }
    }

    let log_turn: Option<LogTurnInput> = if !tool_json_acc.is_empty() {
        serde_json::from_str(&tool_json_acc).ok()
    } else {
        None
    };

    let mut assistant_blocks = vec![];
    if !full_text.is_empty() {
        assistant_blocks.push(json!({ "type": "text", "text": full_text }));
    }
    if let (Some(id), Some(log)) = (&tool_use_id, &log_turn) {
        assistant_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": "log_turn",
            "input": serde_json::to_value(log).unwrap_or(Value::Null)
        }));
    }

    Ok(TurnOutcome {
        full_text,
        log_turn,
        assistant_content: Value::Array(assistant_blocks),
        tool_use_id,
    })
}
