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
}

/** Validates a password against the server and returns session info if it's correct. */
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
  const res = await fetch("/api/history", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { messages: HistoryMessage[] };
  return data.messages;
}

export interface CorrectionEntry {
  timestamp: string;
  original: string;
  corrected: string;
  category: string | null;
}

export interface ProgressInfo {
  level: string;
  totalXp: number;
  streakCurrent: number;
  streakLongest: number;
  corrections: CorrectionEntry[];
  vocabulary: string[];
}

export async function getProgress(token: string): Promise<ProgressInfo | null> {
  const res = await fetch("/api/progress", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as ProgressInfo;
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
