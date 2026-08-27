// Desktop is a thin client of the same backend the PWA uses — this is what
// makes chat history, XP, and streaks shared between phone and PC. There's
// no local dev proxy here (unlike apps/web's vite.config.ts), so this is
// always an absolute URL, even in `tauri dev`.
export const API_BASE = "https://english-buddy-production-b9e2.up.railway.app";
