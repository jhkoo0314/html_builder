"use strict";

const { extractUploadedTexts } = require("../parsers");
const { generatePipeline } = require("../pipelines/generatePipeline");
const { L3BuildError } = require("./errors");

const SLIDE_TYPE_SET = [
  "title-cover",
  "agenda",
  "section-divider",
  "executive-summary",
  "problem-statement",
  "insight",
  "kpi-snapshot",
  "comparison",
  "process-flow",
  "timeline-roadmap",
  "option-recommendation",
  "action-plan",
];

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
    .filter((line) => /^[A-Za-z0-9가-힣]/.test(line))
    .filter((line) => !line.startsWith("# FILE:"))
    .slice(0, 10);
  return heuristic;
}

function inferSlideType({ title, paragraph, idx, total }) {
  const text = `${String(title || "")} ${String(paragraph || "")}`.toLowerCase();
  const hasNumber = /\d+([.,]\d+)?\s*%?/.test(text);

  if (idx === 0) return { type: "title-cover", confidence: 0.95 };
  if (idx === 1 && total >= 4) return { type: "agenda", confidence: 0.68 };
  if (/\b(agenda|목차|개요|순서)\b/.test(text)) return { type: "agenda", confidence: 0.9 };
  if (/\b(summary|요약|결론)\b/.test(text)) return { type: "executive-summary", confidence: 0.82 };
  if (/\b(problem|issue|pain|과제|문제)\b/.test(text)) return { type: "problem-statement", confidence: 0.82 };
  if (/\b(insight|시사점|인사이트)\b/.test(text)) return { type: "insight", confidence: 0.84 };
  if (hasNumber && /\b(kpi|metric|지표|성과|달성)\b/.test(text)) return { type: "kpi-snapshot", confidence: 0.88 };
  if (/\b(vs|compare|comparison|before|after|비교)\b/.test(text)) return { type: "comparison", confidence: 0.84 };
  if (/\b(process|workflow|flow|절차|프로세스)\b/.test(text)) return { type: "process-flow", confidence: 0.8 };
  if (/\b(timeline|roadmap|일정|로드맵|분기|q[1-4])\b/.test(text)) return { type: "timeline-roadmap", confidence: 0.86 };
  if (/\b(option|alternative|recommend|권고|대안)\b/.test(text)) return { type: "option-recommendation", confidence: 0.82 };
  if (/\b(action|next step|owner|due|실행|담당|기한)\b/.test(text)) return { type: "action-plan", confidence: 0.85 };
  if (idx > 0 && idx < total - 1 && idx % 4 === 0) return { type: "section-divider", confidence: 0.52 };

  return { type: "insight", confidence: 0.4 };
}

function createSlidePlan(paragraphs, headings) {
  const seed = headings.length ? headings : paragraphs.map((p) => cleanLine(p).slice(0, 48));
  // Keep enough planning breadth for large decks while avoiding runaway prompts.
  const limited = seed.filter(Boolean).slice(0, 40);
  const total = limited.length;
  return limited.map((title, idx) => {
    const paragraph = paragraphs[idx] || paragraphs[0] || "";
    const bullets = splitSentences(paragraph, 3).map((s) => s.slice(0, 120));
    const evidenceHints = splitSentences(paragraph, 2).map((s) => s.slice(0, 140));
    const inferred = inferSlideType({ title, paragraph, idx, total });
    const alternates = SLIDE_TYPE_SET.filter((name) => name !== inferred.type).slice(0, 2);
    return {
      title: title || `Slide ${idx + 1}`,
      bullets: bullets.length ? bullets : ["Summarize the key point in one clear line."],
      evidenceHints: evidenceHints.length ? evidenceHints : ["Use a concrete sentence from the source as evidence."],
      layoutHint: idx % 3 === 0 ? "kpi-band" : idx % 3 === 1 ? "two-column" : "timeline",
      slideTypeHint: inferred.type,
      slideTypeConfidence: Number(inferred.confidence.toFixed(2)),
      slideTypeAlternates: alternates,
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
    docSummary: docSummary || "Summary text was too short to extract confidently.",
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

async function renderDirect({ analysis, combinedText, sourceFiles, styleMode, toneMode, purposeMode, designPrompt }) {
  const planned = (analysis.slidePlan || []).slice(0, 40);
  const analysisHint = [
    `Title: ${analysis.docTitle}`,
    `Summary: ${analysis.docSummary}`,
    `Headings: ${(analysis.headings || []).slice(0, 40).join(" | ")}`,
    `Planned slides: ${planned.map((item) => item.title).join(" | ")}`,
    `Slide type set: ${SLIDE_TYPE_SET.join(", ")}`,
    "Slide type hints (type-constrained, layout-flexible):",
    ...planned.map((item, idx) =>
      `- S${idx + 1}: ${item.title} | hint=${item.slideTypeHint || "insight"} | confidence=${item.slideTypeConfidence || 0} | alternates=${(item.slideTypeAlternates || []).join("/")}`
    ),
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
    toneMode,
    purposeMode,
  });
}

module.exports = {
  analyzeDirect,
  renderDirect,
};
