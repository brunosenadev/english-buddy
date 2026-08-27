import { useEffect, useState } from "react";
import {
  checkSession,
  clearToken,
  getHistory,
  getToken,
  setToken,
  type HistoryMessage,
  type SessionInfo,
} from "./api";
import Chat from "./Chat";
import PasswordGate from "./PasswordGate";
import ProgressView from "./ProgressView";
import VocabularyView from "./VocabularyView";

type AuthState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; token: string; sessionInfo: SessionInfo; initialMessages: HistoryMessage[] };

type View = "chat" | "progress" | "vocabulary";

async function loadSignedInState(token: string): Promise<AuthState> {
  try {
    // Both only need `token` and hit independent endpoints — no reason to
    // wait for one before starting the other.
    const [sessionInfo, initialMessages] = await Promise.all([
      checkSession(token),
      getHistory(token),
    ]);
    if (!sessionInfo) {
      clearToken();
      return { status: "signed-out" };
    }
    return { status: "signed-in", token, sessionInfo, initialMessages };
  } catch {
    // checkSession can throw on a network failure (unlike a wrong password,
    // which resolves to null) — without this, a blip on launch left the app
    // stuck at `{status: "checking"}` (renders nothing) forever.
    clearToken();
    return { status: "signed-out" };
  }
}

function ChatApp() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [view, setView] = useState<View>("chat");
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuth({ status: "signed-out" });
      return;
    }
    loadSignedInState(token).then(setAuth);
  }, []);

  function handleUnauthorized() {
    clearToken();
    setAuth({ status: "signed-out" });
    setView("chat");
  }

  function handleLogout() {
    handleUnauthorized();
  }

  function handlePasswordChanged(newToken: string) {
    setToken(newToken);
    setAuth((prev) => (prev.status === "signed-in" ? { ...prev, token: newToken } : prev));
  }

  function handleConversationReset() {
    setAuth((prev) => (prev.status === "signed-in" ? { ...prev, initialMessages: [] } : prev));
    setChatKey((k) => k + 1);
  }

  async function handleAuthenticated(token: string, sessionInfo: SessionInfo) {
    setAuth({ status: "checking" });
    const initialMessages = await getHistory(token);
    setAuth({ status: "signed-in", token, sessionInfo, initialMessages });
  }

  // A bare `null` here left the window fully invisible while the token
  // check was in flight — looked like the app just failed to open at all.
  if (auth.status === "checking") {
    return (
      <div className="chat-stage">
        <div className="chat-panel chat-panel-loading" />
      </div>
    );
  }

  if (auth.status === "signed-out") {
    return <PasswordGate onAuthenticated={handleAuthenticated} />;
  }

  return (
    <>
      {/* Always mounted (Progress renders as an overlay on top) so leaving and
          returning to Progress can't reset Chat's kickoff/streak state. */}
      <Chat
        key={chatKey}
        token={auth.token}
        sessionInfo={auth.sessionInfo}
        initialMessages={auth.initialMessages}
        onUnauthorized={handleUnauthorized}
        onOpenProgress={() => setView("progress")}
        onLogout={handleLogout}
        onPasswordChanged={handlePasswordChanged}
        onConversationReset={handleConversationReset}
      />
      {view === "progress" && (
        <ProgressView
          token={auth.token}
          onBack={() => setView("chat")}
          onUnauthorized={handleUnauthorized}
          onOpenVocabulary={() => setView("vocabulary")}
        />
      )}
      {view === "vocabulary" && (
        <VocabularyView
          token={auth.token}
          onBack={() => setView("progress")}
          onUnauthorized={handleUnauthorized}
        />
      )}
    </>
  );
}

export default ChatApp;
