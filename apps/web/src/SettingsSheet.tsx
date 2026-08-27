import { useState } from "react";
import { changePassword, resetConversation } from "./api";
import "./SettingsSheet.css";

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
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

interface SettingsSheetProps {
  token: string;
  onClose: () => void;
  onLogout: () => void;
  onPasswordChanged: (newToken: string) => void;
  onConversationReset: () => void;
}

function SettingsSheet({ token, onClose, onLogout, onPasswordChanged, onConversationReset }: SettingsSheetProps) {
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function doReset() {
    setResetting(true);
    const ok = await resetConversation(token);
    setResetting(false);
    if (ok) onConversationReset();
  }

  async function save() {
    if (!newPassword || saving) return;
    setSaving(true);
    setFeedback(null);
    const result = await changePassword(token, newPassword);
    setSaving(false);
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error ?? "Couldn't change the password." });
      return;
    }
    onPasswordChanged(newPassword);
    setNewPassword("");
    setFeedback({ kind: "success", text: "Password updated." });
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="settings-section">
          <span className="settings-label">Change password</span>
          <div className="settings-row">
            <input
              className="settings-input"
              type="password"
              placeholder="New password"
              value={newPassword}
              disabled={saving}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <button className="settings-save" onClick={save} disabled={saving || !newPassword}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {feedback && <span className={`settings-feedback ${feedback.kind}`}>{feedback.text}</span>}
        </div>

        <div className="settings-section">
          <span className="settings-label">Conversation</span>
          {confirmingReset ? (
            <div className="settings-row">
              <span className="settings-confirm-text">Erase the current conversation context?</span>
              <button className="settings-save danger" onClick={doReset} disabled={resetting}>
                {resetting ? "…" : "Yes, reset"}
              </button>
              <button className="settings-logout" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="settings-logout" onClick={() => setConfirmingReset(true)}>
              Start a new conversation
            </button>
          )}
        </div>

        <div className="settings-section">
          <button className="settings-logout" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsSheet;
