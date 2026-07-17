import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function SummaryPanel({ summary, loading }) {
  if (loading) {
    return (
      <div className="summary summary--loading">
        <div className="summary__skeleton" />
        <div className="summary__skeleton" />
        <div className="summary__skeleton summary__skeleton--short" />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="summary">
      <h2 className="summary__heading">Summary</h2>
      <div className="summary__body markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
      </div>
    </div>
  );
}
