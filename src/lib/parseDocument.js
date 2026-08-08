import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { isCiosFormat, parseCiosCsv, formatCiosText } from "./parseCios";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const EXT_MAP = {
  pdf: "pdf",
  csv: "csv",
  html: "html",
  htm: "html",
  xls: "xls",
  xlsx: "xls",
  doc: "doc",
  docx: "doc",
};

function getExtension(file) {
  const parts = file.name.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

async function parsePdf(file) {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    text += `\n\n--- Page ${i} ---\n${pageText}`;
  }
  return text.trim();
}

async function parseCsvRows(file) {
  const raw = await file.text();
  const result = Papa.parse(raw, { skipEmptyLines: true });
  return result.data; // array of row arrays
}

/**
 * Builds CSV text for the model. If the file is small enough, includes every
 * row. If not, instead of chopping off everything after some byte offset
 * (which would silently drop the back half of the file), it takes an evenly
 * spaced sample of rows across the *entire* file — first row to last — so the
 * model still sees signal from throughout the document, plus a note stating
 * how many rows exist vs. how many are shown.
 */
function buildCsvText(rows, maxChars) {
  if (rows.length === 0) {
    return { text: "", truncated: false, totalRows: 0, sampledRows: 0 };
  }

  const header = rows[0];
  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;
  const headerLine = header.join(" | ");
  const fullText = [headerLine, ...dataRows.map((r) => r.join(" | "))].join("\n");

  if (fullText.length <= maxChars) {
    return { text: fullText, truncated: false, totalRows, sampledRows: totalRows };
  }

  const NOTE_RESERVE = 400;
  const budget = Math.max(0, maxChars - headerLine.length - NOTE_RESERVE);
  const avgLineLen =
    dataRows.reduce((sum, r) => sum + r.join(" | ").length + 1, 0) / Math.max(1, totalRows);
  let sampleCount = Math.max(1, Math.floor(budget / avgLineLen));
  sampleCount = Math.min(sampleCount, totalRows);

  const indices = new Set();
  if (sampleCount >= totalRows) {
    for (let i = 0; i < totalRows; i++) indices.add(i);
  } else {
    for (let i = 0; i < sampleCount; i++) {
      indices.add(Math.round((i * (totalRows - 1)) / Math.max(1, sampleCount - 1)));
    }
  }
  const sortedIndices = Array.from(indices).sort((a, b) => a - b);
  const sampledLines = sortedIndices.map((i) => dataRows[i].join(" | "));

  const note = `\n\n[Note: this CSV has ${totalRows} data rows in total. Because the full file is too large to analyze at once, the rows above are a representative sample of ${sampledLines.length} rows evenly distributed across the entire file — including the first and last rows — rather than only the beginning. Treat any counts or totals as approximate, and say so if asked for an exact count.]`;

  return {
    text: [headerLine, ...sampledLines].join("\n") + note,
    truncated: true,
    totalRows,
    sampledRows: sampledLines.length,
  };
}

async function parseHtml(file) {
  const raw = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return doc.body ? doc.body.innerText.replace(/\n{3,}/g, "\n\n").trim() : raw;
}

async function parseXls(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  let text = "";
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    text += `\n\n--- Sheet: ${sheetName} ---\n${csv}`;
  });
  return text.trim();
}

async function parseDoc(file, ext) {
  if (ext === "doc") {
    throw new Error(
      "Legacy .doc files can't be parsed in the browser. Please re-save the file as .docx and upload again."
    );
  }
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

/**
 * Parses an uploaded report into plain text ready to hand to the model.
 * Supports: PDF, CSV, HTML/HTM, XLS/XLSX, DOC/DOCX.
 */
export async function parseDocument(file) {
  const ext = getExtension(file);
  const kind = EXT_MAP[ext];

  if (!kind) {
    throw new Error(
      `Unsupported file type ".${ext || "unknown"}". Please upload a PDF, CSV, HTML, XLS/XLSX, or DOC/DOCX file.`
    );
  }

  // Guard against extremely large documents blowing the context window.
  // gpt-4o-mini has a 128k-token context window; at roughly 4 chars/token,
  // reserving headroom for the system prompt, the question, and the model's
  // response leaves room for a generous input budget.
  const MAX_CHARS = 150000;

  if (kind === "csv") {
    // CSVs (survey/feedback exports) get a much larger budget than other
    // formats: every row is often a distinct student comment, so sampling
    // rows away means losing real feedback outright, not just losing some
    // redundant text. Only fall back to sampling if the file is genuinely
    // too large to fit in the model's context at all.
    const CSV_MAX_CHARS = 350000;
    const rows = await parseCsvRows(file);
    if (rows.length === 0) {
      throw new Error(
        "No readable text could be extracted from this file. It may be a scanned/image-only document."
      );
    }

    if (isCiosFormat(rows)) {
      // GT's CIOS export is a "pivoted" layout: each question has its own
      // response-scale labels on a separate row, reused for however many
      // following questions share that scale. A single fixed header (the
      // generic path below) can't represent that — it was causing later
      // Likert-scale questions to be labeled with an earlier question's
      // scale (e.g. hours-per-week buckets applied to a preparedness
      // rating). This parses that structure directly instead.
      const parsed = parseCiosCsv(rows);
      let { text, truncated } = formatCiosText(parsed);
      if (text.length > CSV_MAX_CHARS) {
        // Only fall back to sampling comments if the full text is genuinely
        // too large — the quantitative section is always small/fixed-size.
        const totalComments = parsed.comments.length || 1;
        const approxCharsPerComment = text.length / totalComments;
        const maxCommentsPerPrompt = Math.max(
          5,
          Math.floor(CSV_MAX_CHARS / approxCharsPerComment / 5)
        );
        ({ text, truncated } = formatCiosText(parsed, { maxCommentsPerPrompt }));
      }
      return { text, truncated, fileName: file.name, fileType: kind, rows };
    }

    const { text, truncated } = buildCsvText(rows, CSV_MAX_CHARS);
    // `rows` (untouched, full) is kept alongside the bounded summary text so
    // Q&A can build a retrieval index over every row later, regardless of
    // whether the summary text above was sampled.
    return { text, truncated, fileName: file.name, fileType: kind, rows };
  }

  let text;
  switch (kind) {
    case "pdf":
      text = await parsePdf(file);
      break;
    case "html":
      text = await parseHtml(file);
      break;
    case "xls":
      text = await parseXls(file);
      break;
    case "doc":
      text = await parseDoc(file, ext);
      break;
    default:
      throw new Error("Unsupported file type.");
  }

  if (!text || !text.trim()) {
    throw new Error(
      "No readable text could be extracted from this file. It may be a scanned/image-only document."
    );
  }

  const truncated = text.length > MAX_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    truncated,
    fileName: file.name,
    fileType: kind,
    // Full, untouched text kept for building a retrieval index over the
    // entire document later, independent of the summary's size cap.
    fullText: text,
  };
}
