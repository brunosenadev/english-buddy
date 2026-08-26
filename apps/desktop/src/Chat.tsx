import { useState, type ReactNode } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./Chat.css";

interface Message {
  id: number;
  from: "ai" | "user";
  text: string;
}

type ChatEvent =
  | { event: "textDelta"; text: string }
  | { event: "done"; xpAwarded: number; activityClosed: boolean }
  | { event: "error"; message: string };

const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    from: "ai",
    text: "You just fixed a bug. Tell me what was wrong.",
  },
];

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

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
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

let nextId = 2;

function Chat() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, { id: nextId++, from: "user", text }]);

    const aiMessageId = nextId++;
    setMessages((prev) => [...prev, { id: aiMessageId, from: "ai", text: "" }]);

    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (event.event === "textDelta") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessageId ? { ...m, text: m.text + event.text } : m,
          ),
        );
      } else if (event.event === "done") {
        setSending(false);
      } else if (event.event === "error") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessageId
              ? { ...m, text: `Error: ${event.message}` }
              : m,
          ),
        );
        setSending(false);
      }
    };

    invoke("send_message", { text, channel }).catch((err) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId ? { ...m, text: `Error: ${String(err)}` } : m,
        ),
      );
      setSending(false);
    });
  }

  return (
    <div className="chat-stage">
      <div className="chat-panel">
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-header-mark" />
            <span className="chat-title">English Buddy</span>
          </div>
          <div className="chat-header-right">
            <div className="chat-streak">
              <FlameIcon />
              <span className="mono">14</span>
            </div>
            <button
              className="chat-close"
              onClick={() => invoke("toggle_chat_window")}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="chat-body">
          <div className="chat-tag">
            <BoltIcon />
            <span>QUICK CHALLENGE</span>
          </div>

          <div className="chat-messages">
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
    </div>
  );
}

export default Chat;
