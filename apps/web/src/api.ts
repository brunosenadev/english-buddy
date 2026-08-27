const TOKEN_KEY = "eb_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable (e.g. private mode) — token just won't persist across reloads.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export interface SessionInfo {
  level: string;
  turnCount: number;
  totalXp: number;
  streakCurrent: number;
  streakLongest: number;
  streakAtRisk: boolean;
  lastActivityType: string | null;
  hasHistory: boolean;
}

/** Validates a password against the server and returns session info if it's correct.
 * Can throw on a network failure (no fetch response at all) — PasswordGate relies on
 * that to tell "wrong password" apart from "server unreachable"; other callers that
 * don't need the distinction should wrap this in their own try/catch. */
export async function checkSession(token: string): Promise<SessionInfo | null> {
  const res = await fetch("/api/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as SessionInfo;
}

export interface HistoryMessage {
  id: number;
  from: "ai" | "user";
  text: string;
}

export async function getHistory(token: string): Promise<HistoryMessage[]> {
  try {
    const res = await fetch("/api/history", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { messages: HistoryMessage[] };
    return data.messages;
  } catch {
    return [];
  }
}

export interface CorrectionEntry {
  timestamp: string;
  original: string;
  corrected: string;
  category: string | null;
}

export interface FocusItem {
  patternKey: string;
  timesSeen: number;
  timesCorrectSince: number;
  status: string;
}

export interface WeeklySummary {
  activeDays: number;
  xpThisWeek: number;
  correctionsThisWeek: number;
  masteredThisWeek: number;
}

export interface ProgressInfo {
  level: string;
  totalXp: number;
  streakCurrent: number;
  streakLongest: number;
  corrections: CorrectionEntry[];
  vocabulary: string[];
  focusItems: FocusItem[];
  weeklySummary: WeeklySummary;
  weeklyCorrectionTrend: number[];
  todayActivityTypes: string[];
}

export type ProgressResult =
  | { status: "ok"; data: ProgressInfo }
  | { status: "unauthorized" }
  | { status: "error" };

/** Distinguishes "wrong/expired password" from "server hiccup" — a 5xx or a
 * network blip shouldn't force the user back through the password gate. */
export async function getProgress(token: string): Promise<ProgressResult> {
  try {
    const res = await fetch("/api/progress", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { status: "unauthorized" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", data: (await res.json()) as ProgressInfo };
  } catch {
    return { status: "error" };
  }
}

export async function resetConversation(token: string): Promise<boolean> {
  const res = await fetch("/api/reset-conversation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function changePassword(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "request failed" }));
    return { ok: false, error: data.error ?? "request failed" };
  }
  return { ok: true };
}
