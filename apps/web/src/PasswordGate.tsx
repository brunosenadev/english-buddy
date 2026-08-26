import { useState } from "react";
import { checkSession, setToken, type SessionInfo } from "./api";
import "./PasswordGate.css";

interface PasswordGateProps {
  onAuthenticated: (token: string, sessionInfo: SessionInfo) => void;
}

function PasswordGate({ onAuthenticated }: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!password || checking) return;
    setChecking(true);
    setError(null);
    try {
      const sessionInfo = await checkSession(password);
      if (!sessionInfo) {
        setError("Wrong password.");
        return;
      }
      setToken(password);
      onAuthenticated(password, sessionInfo);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="gate-stage">
      <div className="gate-card">
        <div className="gate-mark" />
        <div className="gate-title">English Buddy</div>
        <div className="gate-subtitle">Enter the password to start practicing.</div>
        <input
          className="gate-input"
          type="password"
          placeholder="Password"
          value={password}
          disabled={checking}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoFocus
        />
        {error && <div className="gate-error">{error}</div>}
        <button className="gate-submit" onClick={submit} disabled={checking}>
          {checking ? "Checking…" : "Enter"}
        </button>
      </div>
    </div>
  );
}

export default PasswordGate;
