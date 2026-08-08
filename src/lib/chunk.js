/**
 * Splits a parsed document into small, self-contained chunks for retrieval.
 * Each chunk is embedded once and compared against a question's embedding at
 * query time, so only the most relevant handful ever get sent to the model —
 * instead of needing the entire document to fit in context up front.
 */

import { isCiosFormat, parseCiosCsv, buildCiosChunks } from "./parseCios";

/** One chunk per CSV row, formatted as "column: value" pairs so each row is
 * meaningful on its own without needing the header alongside it. Used for
 * generic/flat CSVs — see buildCiosChunks for GT's pivoted CIOS export. */
function chunkCsvRows(rows) {
  if (!rows || rows.length === 0) return [];
  const header = rows[0];
  const dataRows = rows.slice(1);

  return dataRows.map((row, i) => {
    const fields = header
      .map((col, j) => `${(col || `col${j + 1}`).trim()}: ${(row[j] ?? "").toString().trim()}`)
      .join("; ");
    return { id: `row-${i + 1}`, text: `Row ${i + 1} — ${fields}` };
  });
}

/** Splits prose (PDF/DOC/HTML) into overlapping ~1000-character chunks,
 * breaking on paragraph boundaries where possible so chunks stay coherent. */
function chunkProse(text, { targetSize = 1000, overlap = 120 } = {}) {
  if (!text) return [];
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > targetSize && current) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      current = `${tail}\n\n${para}`;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((text, i) => ({ id: `chunk-${i + 1}`, text }));
}

/**
 * Builds retrieval chunks for a parsed document (see parseDocument.js).
 * Always chunks the *full* document — CSV rows or full prose text — never a
 * sampled/truncated version, since retrieval doesn't need everything to fit
 * in context at once.
 */
export function buildChunks(doc) {
  if (doc.fileType === "csv") {
    if (isCiosFormat(doc.rows)) {
      return buildCiosChunks(parseCiosCsv(doc.rows));
    }
    return chunkCsvRows(doc.rows);
  }
  return chunkProse(doc.fullText || doc.text);
}
