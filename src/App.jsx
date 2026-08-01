import { useEffect, useState } from "react";
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
  const [authChecked, setAuthChecked] = useState(false);
  const [authorizedUser, setAuthorizedUser] = useState(null); // email string, or null if not gatech

  const [stage, setStage] = useState("idle"); // idle | upload | parse | analyze | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [doc, setDoc] = useState(null); // { text, fileName, truncated, fullText/rows }
  const [summary, setSummary] = useState("");
  const [history, setHistory] = useState([]);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [indexing, setIndexing] = useState(false);
  // Lazily built the first time a question is asked: { chunks, embeddings } | null
  const [index, setIndex] = useState(null);

  // staticwebapp.config.json only requires "authenticated" (any Microsoft
  // account) at the platform level — the actual "must be @gatech.edu" check
  // happens here, client-side, and again server-side in the API functions.
  useEffect(() => {
    fetch("/.auth/me")
      .then((r) => r.json())
      .then((data) => {
        const principal = data?.clientPrincipal;
        const email = (principal?.userDetails || "").toLowerCase();
        setAuthorizedUser(email.endsWith("@gatech.edu") ? principal.userDetails : null);
      })
      .catch(() => setAuthorizedUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

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

  if (!authChecked) {
    return null;
  }

  if (!authorizedUser) {
    return (
      <div className="app app--unauthorized">
        <div className="unauthorized-card">
          <img src="/gt-logo.png" alt="Georgia Tech" className="unauthorized-card__logo" />
          <h1>This account isn't authorized</h1>
          <p>
            CIOSynthesis is restricted to Georgia Tech accounts (<strong>@gatech.edu</strong>).
            You're signed in with a Microsoft account that isn't part of Georgia Tech's
            organization, so access isn't available.
          </p>
          <a className="unauthorized-card__button" href="/.auth/logout?post_logout_redirect_uri=/">
            Sign out and try a different account
          </a>
        </div>
      </div>
    );
  }

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
