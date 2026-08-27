// Shared contract between the desktop app and the future PWA.
// This is the input schema for the `log_turn` tool the model calls on every
// assistant turn — never shown to the user, consumed by the client to update
// XP/streak/memory. Keep this file dependency-free (no build step) so both
// a Vite/React app and a Rust build (via a hand-kept mirror struct) can treat
// it as the single source of truth for the shape.

export type ActivityType =
  | "free_conversation"
  | "quick_challenge"
  | "sentence_correction"
  | "fill_blank"
  | "vocabulary"
  | "grammar_drill"
  | "tech_context"
  | "meeting_simulation"
  | "interview_simulation"
  | "explain_topic"
  | "rewrite_natural"
  | "error_review";

export interface CorrectionDetail {
  original: string;
  corrected: string;
  error_category: string;
}

export interface LogTurnInput {
  activity_type: ActivityType;
  correction_given: boolean;
  correction_detail: CorrectionDetail | null;
  new_vocabulary: string[] | null;
  xp_awarded: number;
  activity_closed: boolean;
  next_focus_hint: string | null;
  // Omitted most turns — only set when the model is revising or confidently
  // confirming its read of the user's CEFR level (e.g. "A2", "B1", "B1+").
  estimated_level?: string | null;
}

export type ContextItemCategory =
  | "grammar_error"
  | "vocabulary_gap"
  | "topic_practiced"
  | "general_note";

export type ContextItemStatus = "active" | "mastered" | "archived";

export interface UserContextItem {
  id: string;
  category: ContextItemCategory;
  pattern_key: string;
  example_text: string | null;
  context_note: string | null;
  first_seen_at: string;
  last_seen_at: string;
  times_seen: number;
  times_correct_since: number;
  next_review_at: string | null;
  mastery_score: number;
  status: ContextItemStatus;
  consecutive_failures: number;
  priority_weight: number;
  mnemonic: string | null;
}
