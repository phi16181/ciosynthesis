/**
 * Georgia Tech's CIOS report CSV export uses an unusual "pivoted" layout:
 * each quantitative question has its OWN row of response-bucket labels
 * (hours, percentages, Likert categories, etc.) immediately before its data
 * row — and that label row is reused for however many following questions
 * share the same scale, until a new label row appears. A single fixed
 * header (what a normal CSV parser assumes) cannot represent this: reusing
 * question 1's "hours per week" labels for every later question is exactly
 * what caused a Likert-scale workload/preparedness question to look like it
 * was reporting hours.
 *
 * This module parses that structure properly, tracking the current label
 * set as it changes, and separately handles the open-ended comments section
 * at the bottom of the file (grouped under "Question: ..." prompts).
 */

function isBlank(v) {
  return !v || !v.toString().trim();
}

/** Scans the first several rows for the real header ("Order", "Question
 * Text", ...) — the file sometimes has a blank row before it. */
export function detectCiosHeaderIndex(rows) {
  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const a = (row[0] || "").trim().toLowerCase();
    const b = (row[1] || "").trim().toLowerCase();
    if (a === "order" && b === "question text") return i;
  }
  return -1;
}

export function isCiosFormat(rows) {
  return detectCiosHeaderIndex(rows) !== -1;
}

function isLabelRow(row) {
  const leading = row.slice(0, 5);
  const trailing = row.slice(5);
  return leading.every(isBlank) && trailing.some((c) => !isBlank(c));
}

function isQuestionRow(row) {
  return !isBlank(row[0]) && !isBlank(row[1]) && !isBlank(row[2]);
}

/**
 * Returns { quantitative, comments }.
 * quantitative: [{ order, question, n, responseRate, median, buckets: [{label, count}] }]
 * comments: [{ prompt, text }] — one entry per open-ended response.
 */
export function parseCiosCsv(rows) {
  const headerIdx = detectCiosHeaderIndex(rows);
  const startIdx = headerIdx === -1 ? 0 : headerIdx + 1;

  const quantitative = [];
  const comments = [];
  // The header row's trailing columns (after Order/Question Text/N/RR/Median)
  // double as the first question's own bucket labels — not just generic
  // column titles — so seed currentLabels from it instead of starting null.
  let currentLabels =
    headerIdx === -1
      ? null
      : rows[headerIdx]
          .slice(5)
          .map((c) => (c || "").trim())
          .filter(Boolean);
  let mode = "quant"; // "quant" | "comments"
  let currentPrompt = null;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(isBlank)) continue;
    const firstCell = (row[0] || "").trim();

    if (mode === "quant") {
      if (/^text responses$/i.test(firstCell)) {
        mode = "comments";
        continue;
      }
      if (isLabelRow(row)) {
        currentLabels = row
          .slice(5)
          .map((c) => (c || "").trim())
          .filter(Boolean);
        continue;
      }
      if (isQuestionRow(row)) {
        const [order, question, n, rr, median, ...rest] = row;
        const buckets = [];
        if (currentLabels && currentLabels.length) {
          currentLabels.forEach((label, idx) => {
            const count = rest[idx];
            if (!isBlank(count)) buckets.push({ label, count: count.toString().trim() });
          });
        }
        quantitative.push({
          order: (order || "").trim(),
          question: question.trim(),
          n: (n || "").trim(),
          responseRate: (rr || "").trim(),
          median: (median || "").toString().trim(),
          buckets,
        });
      }
      continue;
    }

    // mode === "comments"
    const qMatch = firstCell.match(/^question:\s*(.+)$/i);
    if (qMatch) {
      currentPrompt = qMatch[1].trim();
      continue;
    }
    if (firstCell) {
      comments.push({ prompt: currentPrompt || "General comments", text: firstCell });
    }
  }

  return { quantitative, comments };
}

function sampleEvenly(arr, k) {
  if (arr.length <= k) return arr;
  const indices = new Set();
  for (let i = 0; i < k; i++) {
    indices.add(Math.round((i * (arr.length - 1)) / Math.max(1, k - 1)));
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => arr[i]);
}

/**
 * Renders parsed CIOS data as plain text for the model. Each question's
 * buckets are printed under that question only — never reused across
 * questions. If `maxCommentsPerPrompt` is given and a prompt has more
 * responses than that, an evenly-spaced sample is shown instead (with a
 * note), the same principle used for oversized plain CSVs elsewhere.
 */
export function formatCiosText({ quantitative, comments }, { maxCommentsPerPrompt } = {}) {
  const lines = [];
  lines.push(
    "QUANTITATIVE RATINGS — each question's response counts use ITS OWN scale labels " +
      "(these differ per question in this export; never assume one question's labels " +
      "apply to another, and never treat a Likert/category scale as a count of hours " +
      "or any other unit unless the label itself says so):"
  );
  for (const q of quantitative) {
    const bucketText = q.buckets.map((b) => `${b.label}: ${b.count}`).join(", ");
    const medianText = q.median ? `, interpolated median ${q.median}` : "";
    lines.push(
      `- ${q.question} (N=${q.n}, response rate ${q.responseRate}${medianText}): ${bucketText}`
    );
  }

  lines.push("");
  lines.push("OPEN-ENDED COMMENTS, grouped by the exact prompt each one answers:");

  const byPrompt = new Map();
  for (const c of comments) {
    if (!byPrompt.has(c.prompt)) byPrompt.set(c.prompt, []);
    byPrompt.get(c.prompt).push(c.text);
  }

  let anySampled = false;
  for (const [prompt, texts] of byPrompt) {
    const included = maxCommentsPerPrompt ? sampleEvenly(texts, maxCommentsPerPrompt) : texts;
    const sampledNote =
      included.length < texts.length
        ? ` — showing ${included.length} of ${texts.length}, evenly sampled`
        : "";
    if (included.length < texts.length) anySampled = true;
    lines.push(`\nQuestion: ${prompt} (${texts.length} responses${sampledNote})`);
    included.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }

  return { text: lines.join("\n"), truncated: anySampled };
}

/**
 * Builds RAG retrieval chunks from parsed CIOS data: one chunk per
 * quantitative question (correctly labeled) and one per individual comment
 * (tagged with the prompt it answers), so every single comment stays
 * individually retrievable no matter how many there are.
 */
export function buildCiosChunks({ quantitative, comments }) {
  const chunks = [];
  quantitative.forEach((q, i) => {
    const bucketText = q.buckets.map((b) => `${b.label}: ${b.count}`).join(", ");
    const medianText = q.median ? `, interpolated median ${q.median}` : "";
    chunks.push({
      id: `quant-${i + 1}`,
      text: `Quantitative rating — ${q.question} (N=${q.n}, response rate ${q.responseRate}${medianText}): ${bucketText}`,
    });
  });
  comments.forEach((c, i) => {
    chunks.push({
      id: `comment-${i + 1}`,
      text: `Open-ended response to "${c.prompt}": ${c.text}`,
    });
  });
  return chunks;
}
