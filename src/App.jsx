import { useState } from "react";
import Header from "./components/Header";
import FileUpload from "./components/FileUpload";
import Pipeline from "./components/Pipeline";
import SummaryPanel from "./components/SummaryPanel";
import QAPanel from "./components/QAPanel";
import { parseDocument } from "./lib/parseDocument";
import { summarizeReport, askAboutReport, embedTexts } from "./lib/openai";
import { buildChunks } from "./lib/chunk";
import { retrieveTopChunks } from "./lib/retrieve";
import "./App.css";

const TOP_K_CHUNKS = 15;

export default function App() {
  const [stage, setStage] = useState("idle"); // idle | upload | parse | analyze | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [doc, setDoc] = useState(null); // { text, fileName, truncated, fullText/rows }
  const [summary, setSummary] = useState("");
  const [history, setHistory] = useState([]);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [indexing, setIndexing] = useState(false);
  // Lazily built the first time a question is asked: { chunks, embeddings } | null
  const [index, setIndex] = useState(null);

  async function handleFile(file) {
    setErrorMessage("");
    setSummary("");
    setHistory([]);
    setDoc(null);
    setIndex(null);
    setStage("upload");

    try {
      setStage("parse");
      const parsed = await parseDocument(file);
      setDoc(parsed);

      setStage("analyze");
      const result = await summarizeReport(parsed);
      setSummary(result);

      setStage("ready");
    } catch (err) {
      setStage("error");
      setErrorMessage(err.message || "Something went wrong processing that file.");
    }
  }

  async function handleAsk(question) {
    if (!doc) return;
    const nextHistory = [...history, { role: "user", content: question }];
    setHistory(nextHistory);
    setPendingAnswer(true);
    try {
      // Build the retrieval index once, on the first question — not upfront
      // on upload — so the whole document never needs to be parsed/embedded
      // unless someone actually asks something.
      let currentIndex = index;
      if (!currentIndex) {
        setIndexing(true);
        const chunks = buildChunks(doc);
        const embeddings = await embedTexts(chunks.map((c) => c.text));
        currentIndex = { chunks, embeddings };
        setIndex(currentIndex);
        setIndexing(false);
      }

      const [queryEmbedding] = await embedTexts([question]);
      const relevantChunks = retrieveTopChunks(
        queryEmbedding,
        currentIndex.embeddings,
        currentIndex.chunks,
        TOP_K_CHUNKS
      );

      const answer = await askAboutReport({
        fileName: doc.fileName,
        question,
        history,
        relevantChunks,
      });
      setHistory([...nextHistory, { role: "assistant", content: answer }]);
    } catch (err) {
      setHistory([
        ...nextHistory,
        {
          role: "assistant",
          content: `Sorry — I couldn't get an answer. ${err.message || ""}`,
        },
      ]);
    } finally {
      setIndexing(false);
      setPendingAnswer(false);
    }
  }

  const isReady = stage === "ready";
  const isProcessing = stage === "upload" || stage === "parse" || stage === "analyze";

  return (
    <div className="app">
      <Header />

      <main className="app__main">
        <section className="app__column app__column--left">
          <FileUpload onFileSelected={handleFile} disabled={isProcessing} />

          {stage !== "idle" && (
            <Pipeline stage={stage} fileName={doc?.fileName} errorMessage={errorMessage} />
          )}

          {doc?.truncated && (
            <p className="app__notice">
              This document was long, so the summary below is based on a representative sample
              spanning the full file. Questions you ask, though, always search the complete
              document — not just that sample.
            </p>
          )}

          <SummaryPanel summary={summary} loading={stage === "analyze"} />
        </section>

        <section className="app__column app__column--right">
          <QAPanel
            history={history}
            onAsk={handleAsk}
            disabled={!isReady}
            pending={pendingAnswer}
            indexing={indexing}
          />
        </section>
      </main>

      <footer className="app__footer">
        Georgia Institute of Technology · CIOSynthesis is an internal analysis tool and does
        not replace review of the original CIOS report.
      </footer>
    </div>
  );
}
