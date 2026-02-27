"use strict";

const { extractUploadedTexts } = require("../parsers");
const { generatePipeline } = require("../pipelines/generatePipeline");
const { L3BuildError } = require("./errors");

function cleanLine(line) {
  return String(line || "").replace(/\s+/g, " ").trim();
}

function splitSentences(text, limit) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, limit);
}

function extractHeadings(lines) {
  const markdownHeadings = lines
    .map((line) => line.match(/^#{1,6}\s+(.+)$/))
    .filter(Boolean)
    .map((m) => cleanLine(m[1]));

  if (markdownHeadings.length) return markdownHeadings.slice(0, 10);

  const heuristic = lines
    .filter((line) => line.length >= 8 && line.length <= 80)
    .filter((line) => /^[A-Z0-9가-힣]/.test(line))
    .filter((line) => !line.startsWith("# FILE:"))
    .slice(0, 10);
  return heuristic;
}

function createSlidePlan(paragraphs, headings) {
  const seed = headings.length ? headings : paragraphs.map((p) => cleanLine(p).slice(0, 48));
  const limited = seed.filter(Boolean).slice(0, 8);
  return limited.map((title, idx) => {
    const paragraph = paragraphs[idx] || paragraphs[0] || "";
    const bullets = splitSentences(paragraph, 3).map((s) => s.slice(0, 120));
    const evidenceHints = splitSentences(paragraph, 2).map((s) => s.slice(0, 140));
    return {
      title: title || `Slide ${idx + 1}`,
      bullets: bullets.length ? bullets : ["핵심 내용을 요약합니다."],
      evidenceHints: evidenceHints.length ? evidenceHints : ["원문 핵심 문장을 근거로 사용"],
      layoutHint: idx % 3 === 0 ? "kpi-band" : idx % 3 === 1 ? "two-column" : "timeline",
    };
  });
}

async function analyzeDirect({ files }) {
  const parsed = await extractUploadedTexts(files);
  const combinedText = cleanLine(parsed.combinedText);
  if (!combinedText) {
    throw new L3BuildError("NO_CONTENT", "Extracted text is empty.", 400);
  }

  const sourceFiles = (files || []).map((f) => f.originalname);
  const rawLines = String(parsed.combinedText)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
  const lines = rawLines.filter((line) => !line.startsWith("# FILE:"));
  const paragraphs = String(parsed.combinedText)
    .split(/\n{2,}/)
    .map(cleanLine)
    .filter((line) => line && !line.startsWith("# FILE:"));
  const headings = extractHeadings(lines);
  const titleFromHeading = headings[0] || "";
  const titleFromLine = lines[0] || sourceFiles[0] || "Untitled Document";
  const docTitle = cleanLine(titleFromHeading || titleFromLine).slice(0, 120);
  const docSummary = splitSentences(paragraphs.join(" "), 3).join(" ").slice(0, 360);
  const slidePlan = createSlidePlan(paragraphs, headings);
  const warnings = [];
  if (headings.length < 2) warnings.push("LOW_STRUCTURE");
  if (slidePlan.length < 2) warnings.push("LOW_SLIDE_PLAN");

  const analysis = {
    docTitle: docTitle || "Untitled Document",
    docSummary: docSummary || "요약 가능한 문장이 충분하지 않습니다.",
    headings,
    slidePlan,
    warnings,
    stats: {
      extractedLength: String(parsed.combinedText || "").length,
      headingCount: headings.length,
      sourceFileCount: sourceFiles.length,
    },
  };

  return {
    analysis,
    combinedText: parsed.combinedText,
    sourceFiles,
  };
}

async function renderDirect({ analysis, combinedText, sourceFiles, styleMode, purposeMode, designPrompt }) {
  const analysisHint = [
    `Title: ${analysis.docTitle}`,
    `Summary: ${analysis.docSummary}`,
    `Headings: ${(analysis.headings || []).slice(0, 8).join(" | ")}`,
    `Planned slides: ${(analysis.slidePlan || []).map((item) => item.title).slice(0, 8).join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return generatePipeline({
    files: [],
    combinedText,
    sourceFiles,
    designPrompt: [analysisHint, designPrompt || ""].filter(Boolean).join("\n\n"),
    creativeMode: String(styleMode || "").toLowerCase() !== "normal",
    styleMode,
    purposeMode,
  });
}

module.exports = {
  analyzeDirect,
  renderDirect,
};
