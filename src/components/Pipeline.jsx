const STAGES = [
  { key: "upload", label: "upload" },
  { key: "parse", label: "parse document" },
  { key: "analyze", label: "synthesize with gpt-4o-mini" },
  { key: "ready", label: "ready" },
];

function StageIcon({ status }) {
  if (status === "done") return <span className="pipeline__icon pipeline__icon--done">✓</span>;
  if (status === "active") return <span className="pipeline__icon pipeline__icon--active" />;
  if (status === "error") return <span className="pipeline__icon pipeline__icon--error">✕</span>;
  return <span className="pipeline__icon pipeline__icon--pending">·</span>;
}

/**
 * stage: one of 'idle' | 'upload' | 'parse' | 'analyze' | 'ready' | 'error'
 */
export default function Pipeline({ stage, fileName, errorMessage }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="pipeline" role="status" aria-live="polite">
      <div className="pipeline__header">
        <span className="pipeline__label">build log</span>
        {fileName && <span className="pipeline__file">{fileName}</span>}
      </div>
      <ol className="pipeline__list">
        {STAGES.map((s, i) => {
          let status = "pending";
          if (stage === "error" && i === Math.max(activeIndex, 0)) status = "error";
          else if (activeIndex > i || stage === "ready") status = "done";
          else if (activeIndex === i) status = "active";

          return (
            <li key={s.key} className={`pipeline__step pipeline__step--${status}`}>
              <StageIcon status={status} />
              <span className="pipeline__step-label">{s.label}</span>
              {status === "active" && <span className="pipeline__ellipsis" />}
            </li>
          );
        })}
      </ol>
      {stage === "error" && errorMessage && (
        <p className="pipeline__error">{errorMessage}</p>
      )}
    </div>
  );
}
