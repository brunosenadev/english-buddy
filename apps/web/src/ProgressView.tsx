import { useEffect, useState } from "react";
import { getProgress, type ProgressInfo } from "./api";
import "./ProgressView.css";

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6M3 22v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L21 8M3 16l2.64 2.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

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
  onOpenVocabulary: () => void;
}

const DAILY_BONUS_THRESHOLD = 3;

function prettyActivity(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function topMistakes(corrections: ProgressInfo["corrections"], limit: number): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of corrections) {
    const key = c.category ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function ProgressView({ token, onBack, onUnauthorized, onOpenVocabulary }: ProgressViewProps) {
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    getProgress(token).then((result) => {
      if (cancelled) return;
      if (result.status === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (result.status === "error") {
        setLoadFailed(true);
        return;
      }
      // Defends against a client/server version mismatch during a deploy
      // (e.g. this build expects a field the currently-live API doesn't
      // send yet) — fill in safe defaults instead of crashing the view.
      setProgress({
        ...result.data,
        focusItems: result.data.focusItems ?? [],
        weeklySummary: result.data.weeklySummary ?? {
          activeDays: 0,
          xpThisWeek: 0,
          correctionsThisWeek: 0,
          masteredThisWeek: 0,
        },
        weeklyCorrectionTrend: result.data.weeklyCorrectionTrend ?? [],
        todayActivityTypes: result.data.todayActivityTypes ?? [],
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reloadTick]);

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
          {!progress && !loadFailed && <div className="progress-empty">Loading…</div>}
          {loadFailed && (
            <div className="progress-error">
              <span>Couldn't load your progress.</span>
              <button className="progress-retry" onClick={() => setReloadTick((t) => t + 1)}>
                <RefreshIcon /> Retry
              </button>
            </div>
          )}
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
                <div className="progress-section-title">This week</div>
                <div className="week-summary">
                  <div className="week-stat">
                    <span className="week-value">{progress.weeklySummary.activeDays}/7</span>
                    <span className="week-label">active days</span>
                  </div>
                  <div className="week-stat">
                    <span className="week-value">{progress.weeklySummary.xpThisWeek}</span>
                    <span className="week-label">XP</span>
                  </div>
                  <div className="week-stat">
                    <span className="week-value">{progress.weeklySummary.masteredThisWeek}</span>
                    <span className="week-label">mastered</span>
                  </div>
                </div>
                <div className="trend-bars">
                  {progress.weeklyCorrectionTrend.map((count, i) => {
                    const max = Math.max(...progress.weeklyCorrectionTrend, 1);
                    return (
                      <div className="trend-bar-col" key={i}>
                        <div className="trend-bar" style={{ height: `${Math.max(4, (count / max) * 100)}%` }} />
                        <span className="trend-bar-label">{count}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="trend-caption">corrections per week, last 4 weeks</div>
              </div>

              <div>
                <div className="progress-section-title">Today</div>
                {progress.todayActivityTypes.length === 0 ? (
                  <div className="progress-empty">No practice yet today.</div>
                ) : (
                  <>
                    <div className="vocab-list">
                      {progress.todayActivityTypes.map((t) => (
                        <span className="vocab-chip" key={t}>
                          {prettyActivity(t)}
                        </span>
                      ))}
                    </div>
                    {progress.todayActivityTypes.length < DAILY_BONUS_THRESHOLD && (
                      <div className="trend-caption">
                        {DAILY_BONUS_THRESHOLD - progress.todayActivityTypes.length} more varied{" "}
                        {DAILY_BONUS_THRESHOLD - progress.todayActivityTypes.length === 1 ? "activity" : "activities"} for
                        today's bonus XP
                      </div>
                    )}
                  </>
                )}
              </div>

              {progress.focusItems.length > 0 && (
                <div>
                  <div className="progress-section-title">Recent focus</div>
                  <div className="focus-list">
                    {progress.focusItems.map((f) => (
                      <div className="focus-item" key={f.patternKey}>
                        <span className="focus-pattern">{f.patternKey}</span>
                        <div className="focus-meter">
                          {Array.from({ length: 5 }, (_, i) => (
                            <span
                              key={i}
                              className={i < f.timesCorrectSince ? "focus-dot filled" : "focus-dot"}
                            />
                          ))}
                        </div>
                        {f.status === "mastered" && <span className="focus-mastered">mastered</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {progress.corrections.length > 0 && (
                <div>
                  <div className="progress-section-title">Common mistakes</div>
                  <div className="vocab-list">
                    {topMistakes(progress.corrections, 6).map((m) => (
                      <span className="vocab-chip" key={m.category}>
                        {m.category} × {m.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

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
                <div className="progress-section-title-row">
                  <div className="progress-section-title">Vocabulary learned</div>
                  {progress.vocabulary.length > 0 && (
                    <button className="progress-link" onClick={onOpenVocabulary}>
                      See all →
                    </button>
                  )}
                </div>
                {progress.vocabulary.length === 0 ? (
                  <div className="progress-empty">No new words logged yet.</div>
                ) : (
                  <div className="vocab-list">
                    {progress.vocabulary.slice(0, 12).map((word) => (
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
