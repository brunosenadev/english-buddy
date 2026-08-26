import { useEffect, useState } from "react";
import { getProgress, type ProgressInfo } from "./api";
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

interface ProgressViewProps {
  token: string;
  onBack: () => void;
  onUnauthorized: () => void;
}

function ProgressView({ token, onBack, onUnauthorized }: ProgressViewProps) {
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  useEffect(() => {
    getProgress(token).then((data) => {
      if (!data) {
        onUnauthorized();
        return;
      }
      setProgress(data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="progress-stage">
      <div className="progress-panel">
        <div className="progress-header">
          <button className="progress-back" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <span className="progress-title">Your progress</span>
        </div>

        <div className="progress-body">
          {progress && (
            <>
              <div className="progress-stats">
                <div className="stat-card">
                  <span className="stat-value">{progress.level}</span>
                  <span className="stat-label">Level</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{progress.totalXp}</span>
                  <span className="stat-label">Total XP</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{progress.streakCurrent}</span>
                  <span className="stat-label">Day streak</span>
                </div>
              </div>

              <div>
                <div className="progress-section-title">Recent corrections</div>
                {progress.corrections.length === 0 ? (
                  <div className="progress-empty">Nothing corrected yet — keep practicing.</div>
                ) : (
                  <div className="correction-list">
                    {progress.corrections.map((c, i) => (
                      <div className="correction-item" key={i}>
                        <span className="correction-original">{c.original}</span>
                        <span className="correction-corrected">{c.corrected}</span>
                        {c.category && <span className="correction-category">{c.category}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="progress-section-title">Vocabulary learned</div>
                {progress.vocabulary.length === 0 ? (
                  <div className="progress-empty">No new words logged yet.</div>
                ) : (
                  <div className="vocab-list">
                    {progress.vocabulary.map((word) => (
                      <span className="vocab-chip" key={word}>
                        {word}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProgressView;
