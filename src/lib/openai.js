// Both endpoints are our own Azure Functions (api/chat, api/embeddings), which
// hold the Azure OpenAI endpoint/key/deployment names server-side. The
// frontend never sees Azure OpenAI credentials directly.
const CHAT_URL = "/api/chat";
const EMBEDDINGS_URL = "/api/embeddings";

const SYSTEM_PROMPT = `You are an assistant helping a Georgia Tech instructor read their Course-Instructor
Opinion Survey (CIOS) report. You'll be given the report's content (or the most relevant
excerpts from it) and should answer clearly and concisely.

When summarizing:
- Group quantitative items sensibly (workload, course effectiveness, instructor ratings) rather than restating every row.
- Do not include a "Response Rate" or "Total Respondents" section — omit participation-count statistics entirely, even if they're computable from the data.
- Surface the most useful signal from open-ended student comments (recurring themes, notable praise or concerns), without quoting excessively.
- Keep an even, descriptive tone — this data may factor into personnel decisions, so avoid editorializing.

When answering follow-up questions, you will be given a set of excerpts retrieved from the
document — the sections most relevant to that specific question, not the whole document.
Answer only from those excerpts, and still use Markdown formatting where it helps (short
lists, bold labels). If the excerpts don't seem to contain the answer, say so plainly and
suggest the question be rephrased, rather than assuming the information isn't in the
document at all — retrieval may simply have missed it.`;

async function chat(messages) {
  const response = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }

  return data.content ?? "";
}

export async function summarizeReport({ text, fileName, truncated }) {
  const userContent = `File: ${fileName}${
    truncated ? "\n(Note: this document was long and has been truncated for length.)" : ""
  }\n\nDocument content:\n"""\n${text}\n"""\n\nProvide a clear, organized summary of this CIOS report for the instructor, covering key quantitative ratings, workload signals, and a synthesis of the open-ended comments. Do not include response rate or total respondents — leave that out entirely.`;

  return chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ]);
}

export async function askAboutReport({ fileName, question, history, relevantChunks }) {
  const excerpts = relevantChunks
    .map((c, i) => `[Excerpt ${i + 1}]\n${c.text}`)
    .join("\n\n");

  const documentContext = `File: ${fileName}\n\nRetrieved excerpts most relevant to the upcoming question (not the full document):\n\n${excerpts}`;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: documentContext },
    {
      role: "assistant",
      content: "Understood. I'll answer using these retrieved excerpts and flag it if they don't seem to contain enough to answer.",
    },
    ...history,
    { role: "user", content: question },
  ];

  return chat(messages);
}

/**
 * Embeds a batch of texts via our /api/embeddings proxy (Azure OpenAI behind
 * the scenes), used both to index a document's chunks once and to embed each
 * question at query time. Batches at 100 inputs per request.
 */
export async function embedTexts(texts) {
  if (!texts || texts.length === 0) return [];

  const BATCH_SIZE = 100;
  const vectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: batch }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `Embeddings request failed (${response.status}).`);
    }

    vectors.push(...(data.embeddings ?? []));
  }

  return vectors;
}
