import { useEffect, useState } from "react";
import { getProgress } from "./api";
import "./ProgressView.css";

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

interface VocabularyViewProps {
  token: string;
  onBack: () => void;
  onUnauthorized: () => void;
}

function VocabularyView({ token, onBack, onUnauthorized }: VocabularyViewProps) {
  const [words, setWords] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getProgress(token).then((result) => {
      if (result.status === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (result.status === "ok") setWords(result.data.vocabulary);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = words?.filter((w) => w.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  return (
    <div className="progress-stage">
      <div className="progress-panel">
        <div className="progress-header">
          <button className="progress-back" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <span className="progress-title">Vocabulary</span>
        </div>

        <div className="progress-body">
          <input
            className="vocab-search"
            placeholder="Search words…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {words === null ? null : words.length === 0 ? (
            <div className="progress-empty">No new words logged yet.</div>
          ) : filtered.length === 0 ? (
            <div className="progress-empty">No matches for "{query}".</div>
          ) : (
            <div className="vocab-list">
              {filtered.map((word) => (
                <span className="vocab-chip" key={word}>
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VocabularyView;
