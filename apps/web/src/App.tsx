import { useEffect, useState } from "react";
import { checkSession, clearToken, getToken, type SessionInfo } from "./api";
import Chat from "./Chat";
import PasswordGate from "./PasswordGate";

type AuthState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; token: string; sessionInfo: SessionInfo };

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuth({ status: "signed-out" });
      return;
    }
    checkSession(token).then((sessionInfo) => {
      if (sessionInfo) {
        setAuth({ status: "signed-in", token, sessionInfo });
      } else {
        clearToken();
        setAuth({ status: "signed-out" });
      }
    });
  }, []);

  function handleUnauthorized() {
    clearToken();
    setAuth({ status: "signed-out" });
  }

  if (auth.status === "checking") return null;

  if (auth.status === "signed-out") {
    return (
      <PasswordGate
        onAuthenticated={(token, sessionInfo) => setAuth({ status: "signed-in", token, sessionInfo })}
      />
    );
  }

  return (
    <Chat token={auth.token} sessionInfo={auth.sessionInfo} onUnauthorized={handleUnauthorized} />
  );
}

export default App;
