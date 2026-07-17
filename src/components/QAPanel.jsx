import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function QAPanel({ history, onAsk, disabled, pending, indexing }) {
  const [question, setQuestion] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, pending]);

  function submit() {
    const trimmed = question.trim();
    if (!trimmed || disabled) return;
    onAsk(trimmed);
    setQuestion("");
  }

  return (
    <div className="qa">
      <h2 className="qa__heading">Ask about this report</h2>

      <div className="qa__thread" ref={scrollRef}>
        {history.length === 0 && !pending && (
          <p className="qa__empty">
            Ask about specific ratings or what students said in their comments — each answer
            searches the full document for the most relevant parts, even in large files.
          </p>
        )}
        {history.map((m, i) => (
          <div key={i} className={`qa__bubble qa__bubble--${m.role}`}>
            {m.role === "assistant" ? (
              <div className="markdown markdown--compact">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            ) : (
              m.content
            )}
          </div>
        ))}
        {pending && (
          <div className="qa__bubble qa__bubble--assistant qa__bubble--pending">
            {indexing ? (
              <span className="qa__indexing-label">
                Indexing the document for search (first question only)…
              </span>
            ) : (
              <>
                <span className="qa__dot" />
                <span className="qa__dot" />
                <span className="qa__dot" />
              </>
            )}
          </div>
        )}
      </div>

      <div className="qa__input-row">
        <textarea
          className="qa__input"
          placeholder={disabled ? "Upload a report to start asking questions…" : "e.g. What did students say about workload?"}
          value={question}
          disabled={disabled}
          rows={2}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="qa__send"
          onClick={submit}
          disabled={disabled || !question.trim()}
          aria-label="Send question"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
