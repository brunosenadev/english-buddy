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

type AuthState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; token: string; sessionInfo: SessionInfo; initialMessages: HistoryMessage[] };

type View = "chat" | "progress";

async function loadSignedInState(token: string): Promise<AuthState> {
  const sessionInfo = await checkSession(token);
  if (!sessionInfo) {
    clearToken();
    return { status: "signed-out" };
  }
  const initialMessages = await getHistory(token);
  return { status: "signed-in", token, sessionInfo, initialMessages };
}

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [view, setView] = useState<View>("chat");

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

  if (auth.status === "checking") return null;

  if (auth.status === "signed-out") {
    return (
      <PasswordGate
        onAuthenticated={(token, sessionInfo) =>
          setAuth({ status: "signed-in", token, sessionInfo, initialMessages: [] })
        }
      />
    );
  }

  if (view === "progress") {
    return (
      <ProgressView
        token={auth.token}
        onBack={() => setView("chat")}
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  return (
    <Chat
      token={auth.token}
      sessionInfo={auth.sessionInfo}
      initialMessages={auth.initialMessages}
      onUnauthorized={handleUnauthorized}
      onOpenProgress={() => setView("progress")}
      onLogout={handleLogout}
      onPasswordChanged={handlePasswordChanged}
    />
  );
}

export default App;
