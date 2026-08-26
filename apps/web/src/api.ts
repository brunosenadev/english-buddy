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
}

/** Validates a password against the server and returns session info if it's correct. */
export async function checkSession(token: string): Promise<SessionInfo | null> {
  const res = await fetch("/api/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as SessionInfo;
}
