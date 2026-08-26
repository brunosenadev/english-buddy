import { useRef, useState, type ReactNode } from "react";
import type { HistoryMessage, SessionInfo } from "./api";
import "./Chat.css";
import SettingsSheet from "./SettingsSheet";

interface Message {
  id: number;
  from: "ai" | "user";
  text: string;
}

type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; xpAwarded: number; activityClosed: boolean; streakCurrent: number; totalXp: number }
  | { type: "error"; message: string };

const OPENING_MESSAGE: Message = {
  id: 1,
  from: "ai",
  text: "You just fixed a bug. Tell me what was wrong.",
};

function FlameIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22c4.2 0 7.2-2.9 7.2-6.9 0-2.8-1.7-4.7-2.7-6.2-.4 1.8-1.7 2.7-1.7 2.7.5-3.6-1.7-5.4-3.5-7.1-1 2.7 0 4.5-1.8 6.3-1.8 1.8-2.7 3.6-2.7 4.3 0 3.7 2.9 6.9 5.2 6.9Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 11l18-8-8 18-2.5-7.5L3 11Z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

// The model writes plain markdown (**bold**, *italic*, `code`) — this is a
// minimal inline renderer for just those, not a full markdown parser.
const INLINE_MARKDOWN = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;

function MessageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_MARKDOWN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    if (match[2] !== undefined) parts.push(<strong key={key++}>{match[2]}</strong>);
    else if (match[3] !== undefined) parts.push(<em key={key++}>{match[3]}</em>);
    else if (match[4] !== undefined) parts.push(<code key={key++}>{match[4]}</code>);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

let nextId = 1000;

interface ChatProps {
  token: string;
  sessionInfo: SessionInfo;
  initialMessages: HistoryMessage[];
  onUnauthorized: () => void;
  onOpenProgress: () => void;
  onLogout: () => void;
  onPasswordChanged: (newToken: string) => void;
}

function Chat({
  token,
  sessionInfo,
  initialMessages,
  onUnauthorized,
  onOpenProgress,
  onLogout,
  onPasswordChanged,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.length > 0 ? initialMessages : [OPENING_MESSAGE],
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streak, setStreak] = useState(sessionInfo.streakCurrent);
  const [xpToast, setXpToast] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
    });
  }

  function showXpToast(amount: number) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setXpToast(amount);
    toastTimer.current = setTimeout(() => setXpToast(null), 2200);
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, { id: nextId++, from: "user", text }]);

    const aiMessageId = nextId++;
    setMessages((prev) => [...prev, { id: aiMessageId, from: "ai", text: "" }]);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text }),
      });

      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok || !res.body) {
        throw new Error(`request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, newlineIndex);
          buf = buf.slice(newlineIndex + 1);
          if (!line.trim()) continue;

          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "delta") {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMessageId ? { ...m, text: m.text + event.text } : m)),
            );
            scrollToBottom();
          } else if (event.type === "done") {
            setStreak(event.streakCurrent);
            if (event.xpAwarded > 0) showXpToast(event.xpAwarded);
          } else if (event.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId ? { ...m, text: `Error: ${event.message}` } : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMessageId ? { ...m, text: `Error: ${String(err)}` } : m)),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-stage">
      <div className="chat-panel">
        {xpToast !== null && <div className="xp-toast">+{xpToast} XP</div>}

        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-header-mark" />
            <span className="chat-title">English Buddy</span>
            <span className="level-badge">{sessionInfo.level}</span>
          </div>
          <div className="chat-header-right">
            <div className="chat-streak">
              <FlameIcon />
              <span className="mono">{streak}</span>
            </div>
            <button className="chat-icon-btn" onClick={onOpenProgress} aria-label="Progress">
              <ChartIcon />
            </button>
            <button className="chat-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <GearIcon />
            </button>
          </div>
        </div>

        <div className="chat-body">
          <div className="chat-tag">
            <BoltIcon />
            <span>QUICK CHALLENGE</span>
          </div>

          <div className="chat-messages" ref={messagesRef}>
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.from === "ai" ? "bubble-msg ai-msg" : "bubble-msg user-msg"
                }
              >
                <MessageText text={m.text} />
              </div>
            ))}
          </div>

          <div className="chat-input-row">
            <input
              className="chat-input"
              placeholder="Type your answer in English…"
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
            />
            <button
              className="chat-send"
              onClick={sendMessage}
              disabled={sending}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsSheet
          token={token}
          onClose={() => setSettingsOpen(false)}
          onLogout={onLogout}
          onPasswordChanged={onPasswordChanged}
        />
      )}
    </div>
  );
}

export default Chat;
