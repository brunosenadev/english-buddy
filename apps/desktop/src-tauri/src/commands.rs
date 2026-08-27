use crate::claude::{self, ChatEvent};
use crate::state::SharedState;
use serde_json::json;
use tauri::{ipc::Channel, State};

/// A per-turn nudge on top of the system prompt's language-balance rule —
/// repeating it fresh right before generation measurably improves how often
/// the model actually follows it, versus relying on the system prompt alone.
fn language_reminder(level: &str) -> &'static str {
    let l = level.to_uppercase();
    if l.starts_with('A') {
        "Reminder: explain almost everything in Portuguese this turn — only the target English sentence/prompt should be in English."
    } else if l.starts_with("B1") {
        "Reminder: keep explanations and instructions mostly in Portuguese this turn. English is only for the practice sentence/prompt itself and a few simple recurring phrases."
    } else if l.starts_with("B2") {
        "Reminder: explanations can be mostly English now, dropping to Portuguese only for a genuinely tricky nuance."
    } else if l.starts_with('C') {
        "Reminder: full English is fine now — Portuguese only if he seems truly stuck."
    } else {
        "Reminder: when unsure, default to Portuguese for explanations — only the target English sentence/prompt should be in English."
    }
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, SharedState>,
    channel: Channel<ChatEvent>,
    text: String,
) -> Result<(), String> {
    let (client, api_key, mut history, context_block) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let (level, estimated_level) =
            crate::db::get_profile_level(&guard.db).unwrap_or(("B1".to_string(), None));
        let turn_count = crate::db::count_turns(&guard.db).unwrap_or(0);
        let level_display = estimated_level.as_deref().unwrap_or(level.as_str());
        let context_block = format!(
            "Context for this turn — not part of the conversation, never quote it back: total turns so far is {turn_count}. Current estimated level: {level_display}{}. {}",
            if turn_count < 15 {
                " (still calibrating — few data points so far, treat as a rough default)"
            } else {
                ""
            },
            language_reminder(level_display)
        );
        (
            guard.client.clone(),
            guard.api_key.clone(),
            guard.history.clone(),
            context_block,
        )
    };

    history.push(json!({
        "role": "user",
        "content": [{ "type": "text", "text": text }]
    }));

    let outcome = match claude::stream_turn(
        &client,
        &api_key,
        claude::MODEL_HAIKU,
        &history,
        &context_block,
        &channel,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(e) => {
            let _ = channel.send(ChatEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    history.push(json!({
        "role": "assistant",
        "content": outcome.assistant_content
    }));

    if let Some(tool_use_id) = &outcome.tool_use_id {
        history.push(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": "logged"
            }]
        }));
    }

    let (xp_awarded, activity_closed) = outcome
        .log_turn
        .as_ref()
        .map(|l| (l.xp_awarded, l.activity_closed))
        .unwrap_or((0, false));

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.history = history;

        let turn_id = uuid::Uuid::new_v4().to_string();
        let session_id = guard.session_id.clone();
        let log = outcome.log_turn.clone();

        let _ = guard.db.execute(
            "INSERT INTO turns (
                id, session_id, role, text, activity_type, xp_awarded,
                correction_given, correction_original, correction_corrected,
                correction_error_category, new_vocabulary, activity_closed, next_focus_hint
            ) VALUES (?1,?2,'assistant',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                turn_id,
                session_id,
                outcome.full_text,
                log.as_ref().map(|l| l.activity_type.clone()),
                log.as_ref().map(|l| l.xp_awarded).unwrap_or(0),
                log.as_ref().map(|l| l.correction_given).unwrap_or(false) as i32,
                log.as_ref()
                    .and_then(|l| l.correction_detail.as_ref())
                    .map(|c| c.original.clone()),
                log.as_ref()
                    .and_then(|l| l.correction_detail.as_ref())
                    .map(|c| c.corrected.clone()),
                log.as_ref()
                    .and_then(|l| l.correction_detail.as_ref())
                    .map(|c| c.error_category.clone()),
                log.as_ref()
                    .and_then(|l| l.new_vocabulary.as_ref())
                    .map(|v| serde_json::to_string(v).unwrap_or_default()),
                log.as_ref().map(|l| l.activity_closed).unwrap_or(false) as i32,
                log.as_ref().and_then(|l| l.next_focus_hint.clone()),
            ],
        );

        if let Some(new_level) = log.as_ref().and_then(|l| l.estimated_level.as_deref()) {
            let _ = crate::db::update_profile_level(&guard.db, new_level);
        }
    }

    let _ = channel.send(ChatEvent::Done {
        xp_awarded,
        activity_closed,
    });

    Ok(())
}
