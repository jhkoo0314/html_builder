"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const { extractUploadedTexts } = require("../parsers");
const { runWithModelFallback } = require("../llm/gemini/client");
const { getEnv } = require("../config/env");

const STORE = new Map();
const LOG_BUS = new EventEmitter();
LOG_BUS.setMaxListeners(200);

const MAX_QUESTIONS = 3;
const MAX_LLM_CALLS = 2;
const CONTEXT_CHAR_CAP = 16000;

const THEME_LABELS = {
  A: "Signature Premium",
  B: "Enterprise Swiss",
  C: "Minimal Keynote",
  D: "Analytical Dashboard",
  E: "Deep Tech Dark",
};

const SLIDE_TYPES = [
  "title-cover",
  "agenda",
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

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 12);
}

function parseJsonFromText(text) {
  const src = String(text || "").trim();
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch (_error) {
    const start = src.indexOf("{");
    const end = src.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(src.slice(start, end + 1));
      } catch (_error2) {
        return null;
      }
    }
    return null;
  }
}

function clampTheme(value) {
  const key = String(value || "").toUpperCase();
  return THEME_LABELS[key] ? key : "B";
}

function selectThemeByRules(analysis) {
  const density = Number(analysis && analysis.dataDensityScore);
  const text = `${analysis && analysis.purpose ? analysis.purpose : ""} ${analysis && analysis.audience ? analysis.audience : ""}`.toLowerCase();
  if (density >= 75) return "D";
  if (/\b(ai|security|developer|dev|tech)\b/.test(text)) return "E";
  if (/\b(executive|b2b|report|consulting|board)\b/.test(text)) return "B";
  if (/\b(pitch|startup|innovation|launch)\b/.test(text)) return "A";
  if (/\b(portfolio|personal|keynote)\b/.test(text)) return "C";
  return "B";
}

function buildPromptAnalyze(source) {
  return [
    "You are a document analyzer for web-slide planning.",
    "Return JSON only.",
    "Schema:",
    "{",
    '  "title":"string",',
    '  "summary":"string",',
    '  "audience":"string",',
    '  "purpose":"string",',
    '  "dataDensityScore":0-100,',
    '  "uncertaintyScore":0-100,',
    '  "missingInfo":["string"]',
    "}",
    "Rules:",
    "- summary <= 320 chars",
    "- missingInfo <= 5",
    "- no markdown",
    "",
    "Source:",
    source,
  ].join("\n");
}

function buildPromptQuestions(analysis) {
  return [
    "Generate clarification questions for slide generation.",
    "Return JSON only.",
    "Schema:",
    "{",
    '  "questions":[{"id":"q1","question":"string","reason":"string"}]',
    "}",
    "Rules:",
    `- max ${MAX_QUESTIONS} questions`,
    "- if uncertainty is low, return []",
    "- each question answerable in one sentence",
    "- question and reason must be written in Korean (Hangul)",
    "- do not use English unless it is an unavoidable proper noun",
    "",
    "Analysis:",
    JSON.stringify(analysis),
  ].join("\n");
}

function createContext({ runId, combinedText, sourceFiles }) {
  const createdAt = nowIso();
  return {
    runId,
    createdAt,
    updatedAt: createdAt,
    sourceFiles: sourceFiles || [],
    sourceHash: shortHash(combinedText),
    combinedText: combinedText.slice(0, CONTEXT_CHAR_CAP),
    step: "ANALYZED",
    llmCallsUsed: 0,
    analysis: null,
    questions: null,
    answers: [],
    blueprint: null,
    approved: false,
    themeLocked: null,
    html: "",
    logs: [],
  };
}

function statusSnapshot(ctx) {
  return {
    runId: ctx.runId,
    step: ctx.step,
    llmCallsUsed: ctx.llmCallsUsed,
    maxLlmCalls: MAX_LLM_CALLS,
    approved: ctx.approved,
    hasBlueprint: Boolean(ctx.blueprint),
    hasHtml: Boolean(ctx.html),
    theme: ctx.themeLocked
      ? { key: ctx.themeLocked, label: THEME_LABELS[ctx.themeLocked] }
      : null,
    updatedAt: ctx.updatedAt,
  };
}

function appendLog(ctx, stage, message, llmCall) {
  const entry = {
    at: nowIso(),
    stage,
    message,
    llmCall: Boolean(llmCall),
  };
  ctx.logs.push(entry);
  ctx.updatedAt = nowIso();
  LOG_BUS.emit(`log:${ctx.runId}`, entry);
  LOG_BUS.emit(`status:${ctx.runId}`, statusSnapshot(ctx));
}

function ensureLlmBudget(ctx) {
  if (ctx.llmCallsUsed >= MAX_LLM_CALLS) {
    const error = new Error("LLM_CALL_BUDGET_EXCEEDED");
    error.code = "LLM_CALL_BUDGET_EXCEEDED";
    throw error;
  }
}

function getContextOrThrow(runId) {
  const ctx = STORE.get(String(runId || ""));
  if (!ctx) {
    const error = new Error("PROMPT_FLOW_NOT_FOUND");
    error.code = "PROMPT_FLOW_NOT_FOUND";
    throw error;
  }
  return ctx;
}

async function runCheapJson(prompt, errorCode) {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    const error = new Error("GEMINI_API_KEY is missing.");
    error.code = "NO_API_KEY";
    throw error;
  }
  const result = await runWithModelFallback({
    apiKey: env.GEMINI_API_KEY,
    candidates: ["gemini-3-flash-preview", "gemini-2.5-flash"],
    prompt,
    totalBudgetMs: 45000,
    attemptTimeoutMs: 25000,
    minRemainingMs: 2500,
    modelTimeoutsMs: {
      "gemini-3-flash-preview": 20000,
      "gemini-2.5-flash": 25000,
    },
  });
  if (!result.ok) {
    const error = new Error(result.reasonCode || "LLM_ERROR");
    error.code = result.reasonCode || "LLM_ERROR";
    throw error;
  }
  const json = parseJsonFromText(result.text);
  if (!json) {
    const error = new Error(errorCode || "INVALID_JSON_RESPONSE");
    error.code = errorCode || "INVALID_JSON_RESPONSE";
    throw error;
  }
  return json;
}

async function collectSource({ files, pastedText }) {
  const normalized = safeText(pastedText);
  const sourceFiles = [];
  let combinedText = "";

  if (Array.isArray(files) && files.length) {
    const parsed = await extractUploadedTexts(files);
    combinedText = String(parsed.combinedText || "").trim();
    sourceFiles.push(...files.map((f) => String(f.originalname || "upload.txt")));
  }
  if (normalized) {
    const block = `# FILE: pasted-text\n${normalized}`;
    combinedText = combinedText ? `${combinedText}\n\n${block}` : block;
    sourceFiles.push("pasted-text");
  }

  const clipped = combinedText.slice(0, CONTEXT_CHAR_CAP).trim();
  if (!clipped) {
    const error = new Error("NO_CONTENT");
    error.code = "NO_CONTENT";
    throw error;
  }
  return { combinedText: clipped, sourceFiles };
}

async function analyze({ files, pastedText }) {
  const { combinedText, sourceFiles } = await collectSource({ files, pastedText });
  const runId = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const ctx = createContext({ runId, combinedText, sourceFiles });
  ensureLlmBudget(ctx);

  const raw = await runCheapJson(buildPromptAnalyze(ctx.combinedText), "ANALYZE_INVALID_JSON");
  ctx.llmCallsUsed += 1;
  ctx.analysis = {
    title: safeText(raw.title) || "Untitled Deck",
    summary: safeText(raw.summary) || "Summary unavailable.",
    audience: safeText(raw.audience) || "General audience",
    purpose: safeText(raw.purpose) || "General report",
    dataDensityScore: Number.isFinite(Number(raw.dataDensityScore)) ? Number(raw.dataDensityScore) : 50,
    uncertaintyScore: Number.isFinite(Number(raw.uncertaintyScore)) ? Number(raw.uncertaintyScore) : 50,
    missingInfo: Array.isArray(raw.missingInfo) ? raw.missingInfo.map((x) => safeText(x)).filter(Boolean).slice(0, 5) : [],
  };
  appendLog(ctx, 1, "Step 1 complete: document analysis generated.", true);

  STORE.set(ctx.runId, ctx);
  return {
    ok: true,
    runId: ctx.runId,
    step: 1,
    llmCallsUsed: ctx.llmCallsUsed,
    maxLlmCalls: MAX_LLM_CALLS,
    analysis: ctx.analysis,
    logs: ctx.logs,
    status: statusSnapshot(ctx),
  };
}

async function generateQuestions({ runId }) {
  const ctx = getContextOrThrow(runId);
  if (ctx.questions) {
    return {
      ok: true,
      runId: ctx.runId,
      step: 2,
      llmCallsUsed: ctx.llmCallsUsed,
      maxLlmCalls: MAX_LLM_CALLS,
      questions: ctx.questions,
      logs: ctx.logs,
      status: statusSnapshot(ctx),
      cached: true,
    };
  }
  ensureLlmBudget(ctx);
  const raw = await runCheapJson(buildPromptQuestions(ctx.analysis), "QUESTION_INVALID_JSON");
  ctx.llmCallsUsed += 1;
  ctx.questions = Array.isArray(raw.questions)
    ? raw.questions.map((q, idx) => ({
      id: safeText(q && q.id) || `q${idx + 1}`,
      question: safeText(q && q.question),
      reason: safeText(q && q.reason),
    })).filter((q) => q.question).slice(0, MAX_QUESTIONS)
    : [];
  ctx.step = "QUESTIONED";
  appendLog(ctx, 2, ctx.questions.length ? "Step 2 complete: clarification questions created." : "Step 2 complete: no clarification needed.", true);

  return {
    ok: true,
    runId: ctx.runId,
    step: 2,
    llmCallsUsed: ctx.llmCallsUsed,
    maxLlmCalls: MAX_LLM_CALLS,
    questions: ctx.questions,
    logs: ctx.logs,
    status: statusSnapshot(ctx),
  };
}

function splitSentences(text, max) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => safeText(x))
    .filter(Boolean)
    .slice(0, max);
}

function makeSlidesLocal(analysis, answers, combinedText) {
  const sentences = splitSentences(combinedText, 24);
  const answerLine = (answers || []).join(" ");
  const head = safeText(analysis && analysis.title) || "Overview";
  const summary = safeText(analysis && analysis.summary) || (sentences[0] || "Summary");
  const audience = safeText(analysis && analysis.audience) || "General audience";
  const purpose = safeText(analysis && analysis.purpose) || "General report";

  const base = [
    {
      title: head,
      message: "Presentation goal and context.",
      visualType: "hero-stats",
      bullets: [summary, `Audience: ${audience}`, `Purpose: ${purpose}`],
    },
    {
      title: "Key Findings",
      message: "High-impact facts from source material.",
      visualType: "kpi-cards",
      bullets: sentences.slice(1, 4),
    },
    {
      title: "Problem and Opportunity",
      message: "What blocks progress and where leverage exists.",
      visualType: "comparison",
      bullets: sentences.slice(4, 7),
    },
    {
      title: "Recommended Direction",
      message: "Decision options and preferred path.",
      visualType: "option-matrix",
      bullets: answerLine ? splitSentences(answerLine, 3) : sentences.slice(7, 10),
    },
    {
      title: "Execution Plan",
      message: "Phased actions and ownership.",
      visualType: "process-flow",
      bullets: sentences.slice(10, 13),
    },
    {
      title: "Next Steps",
      message: "Immediate actions and review checkpoints.",
      visualType: "timeline",
      bullets: ["Assign owners", "Set review cadence", "Track KPI changes"],
    },
  ];

  return base.map((slide, idx) => ({
    title: safeText(slide.title) || `Slide ${idx + 1}`,
    message: safeText(slide.message) || "Core message",
    visualType: safeText(slide.visualType) || "kpi-cards",
    bullets: Array.isArray(slide.bullets)
      ? slide.bullets.map((b) => safeText(b)).filter(Boolean).slice(0, 4)
      : ["Key point"],
  }));
}

function buildBlueprintLocal(ctx, answers) {
  const normalizedAnswers = Array.isArray(answers)
    ? answers.map((x) => safeText(x)).filter(Boolean).slice(0, 8)
    : [];
  ctx.answers = normalizedAnswers;
  const theme = selectThemeByRules(ctx.analysis);
  ctx.blueprint = {
    deckTitle: safeText(ctx.analysis && ctx.analysis.title) || "Generated Deck",
    themeCandidate: theme,
    themeReason: `Auto-selected by analysis profile (${THEME_LABELS[theme]}).`,
    slides: makeSlidesLocal(ctx.analysis, normalizedAnswers, ctx.combinedText),
  };
  ctx.step = "BLUEPRINTED";
  appendLog(ctx, 3, "Step 3 complete: local blueprint generated (no LLM call).", false);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getThemeTokens(themeKey) {
  const key = clampTheme(themeKey);
  if (key === "A") return { bg: "#0b1020", surface: "rgba(255,255,255,0.12)", border: "rgba(255,255,255,0.24)", text: "#eaf2ff", accent: "#4fd1c5" };
  if (key === "C") return { bg: "#ffffff", surface: "#ffffff", border: "#111111", text: "#111111", accent: "#111111" };
  if (key === "D") return { bg: "#f5f7fa", surface: "#ffffff", border: "#dbe2ea", text: "#102130", accent: "#0b7285" };
  if (key === "E") return { bg: "#020617", surface: "rgba(15,23,42,0.85)", border: "#155e75", text: "#d1f5ff", accent: "#22d3ee" };
  return { bg: "#f8fafc", surface: "#ffffff", border: "#cbd5e1", text: "#0f172a", accent: "#0f766e" };
}

function buildHtml(ctx) {
  const themeKey = clampTheme(ctx.themeLocked || (ctx.blueprint && ctx.blueprint.themeCandidate));
  const tokens = getThemeTokens(themeKey);
  const slides = (ctx.blueprint && ctx.blueprint.slides ? ctx.blueprint.slides : []).slice(0, 12);
  const sections = slides.map((slide, idx) => {
    const type = SLIDE_TYPES[idx % SLIDE_TYPES.length];
    const bullets = (slide.bullets || []).slice(0, 4).map((b) => `<li>${escapeHtml(b)}</li>`).join("") || "<li>Key point</li>";
    return [
      `<section class="slide${idx === 0 ? " active" : ""}" data-slide-type="${type}" data-index="${idx}">`,
      "  <div class=\"content-group\">",
      `    <h2>${escapeHtml(slide.title)}</h2>`,
      `    <p class="message">${escapeHtml(slide.message)}</p>`,
      "    <div class=\"visual-grid\">",
      `      <div class="kpi-card"><span class="label">Visual</span><strong>${escapeHtml(slide.visualType || "kpi-cards")}</strong></div>`,
      `      <div class="kpi-card"><span class="label">Slide</span><strong>${idx + 1}/${slides.length}</strong></div>`,
      "    </div>",
      `    <ul>${bullets}</ul>`,
      "  </div>",
      "</section>",
    ].join("\n");
  }).join("\n");

  return [
    "<!doctype html>",
    "<html lang=\"ko\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>${escapeHtml((ctx.blueprint && ctx.blueprint.deckTitle) || "WebSlide Deck")}</title>`,
    "  <style>",
    "    :root {",
    `      --bg: ${tokens.bg};`,
    `      --surface: ${tokens.surface};`,
    `      --border: ${tokens.border};`,
    `      --text: ${tokens.text};`,
    `      --accent: ${tokens.accent};`,
    "      --radius: 18px;",
    "    }",
    "    * { box-sizing: border-box; }",
    "    html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); color: var(--text); font-family: 'Segoe UI', Arial, sans-serif; }",
    "    .deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }",
    "    .slide { position: absolute; inset: 0; padding: 56px; visibility: hidden; pointer-events: none; opacity: 0; transition: opacity 220ms ease; display: grid; place-items: center; }",
    "    .slide.active { visibility: visible; pointer-events: auto; opacity: 1; }",
    "    .content-group { width: min(1100px, 92vw); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 30px; height: auto; }",
    "    h2 { margin: 0 0 10px; font-size: clamp(28px, 4vw, 48px); }",
    "    .message { margin: 0 0 18px; line-height: 1.5; }",
    "    .visual-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-bottom: 16px; }",
    "    .kpi-card { border: 1px solid var(--border); border-radius: 12px; padding: 12px; background: rgba(255,255,255,0.04); }",
    "    .kpi-card .label { display: block; font-size: 12px; opacity: 0.8; margin-bottom: 4px; }",
    "    ul { margin: 0; padding-left: 18px; line-height: 1.5; }",
    "    .controls { position: fixed; right: 20px; bottom: 20px; display: flex; gap: 8px; }",
    "    .controls button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 10px; padding: 8px 12px; cursor: pointer; }",
    "    .controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }",
    "    @media print {",
    "      .controls { display: none !important; }",
    "      .slide { position: relative !important; visibility: visible !important; pointer-events: auto !important; opacity: 1 !important; page-break-after: always; min-height: 100vh; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main class=\"deck\" id=\"deck\">",
    sections,
    "  </main>",
    "  <div class=\"controls\">",
    "    <button id=\"prevBtn\" type=\"button\">Prev</button>",
    "    <button id=\"nextBtn\" type=\"button\">Next</button>",
    "  </div>",
    "  <script>",
    "    (function () {",
    "      const slides = Array.from(document.querySelectorAll('.slide'));",
    "      let current = 0;",
    "      let isAnimating = false;",
    "      function cleanupLayers(activeIndex) {",
    "        for (let i = 0; i < slides.length; i += 1) {",
    "          const node = slides[i];",
    "          const active = i === activeIndex;",
    "          node.style.visibility = active ? 'visible' : 'hidden';",
    "          node.style.pointerEvents = active ? 'auto' : 'none';",
    "          node.style.opacity = active ? '1' : '0';",
    "          node.classList.toggle('active', active);",
    "        }",
    "      }",
    "      function goToSlide(index) {",
    "        if (isAnimating) return;",
    "        if (!slides[index]) return;",
    "        isAnimating = true;",
    "        setTimeout(function () { isAnimating = false; }, 1000);",
    "        try {",
    "          current = index;",
    "          cleanupLayers(current);",
    "        } finally {",
    "          isAnimating = false;",
    "        }",
    "      }",
    "      document.getElementById('prevBtn').addEventListener('click', function () {",
    "        goToSlide(current <= 0 ? slides.length - 1 : current - 1);",
    "      });",
    "      document.getElementById('nextBtn').addEventListener('click', function () {",
    "        goToSlide(current >= slides.length - 1 ? 0 : current + 1);",
    "      });",
    "      document.addEventListener('keydown', function (event) {",
    "        if (event.key === 'ArrowRight' || event.key === 'PageDown') goToSlide(current >= slides.length - 1 ? 0 : current + 1);",
    "        if (event.key === 'ArrowLeft' || event.key === 'PageUp') goToSlide(current <= 0 ? slides.length - 1 : current - 1);",
    "      });",
    "      cleanupLayers(0);",
    "    }());",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function runStepsThreeToFive(ctx, answers) {
  if (!ctx.blueprint) buildBlueprintLocal(ctx, answers);
  if (!ctx.themeLocked) {
    ctx.themeLocked = clampTheme(ctx.blueprint.themeCandidate);
    ctx.step = "THEME_LOCKED";
    appendLog(ctx, 4, `Step 4 complete: theme selected ${ctx.themeLocked} (${THEME_LABELS[ctx.themeLocked]}).`, false);
  }
  if (!ctx.html) {
    ctx.html = buildHtml(ctx);
    ctx.step = "BUILT";
    appendLog(ctx, 5, "Step 5 complete: HTML generated locally without LLM call.", false);
  }
}

function approveAndAutoRun({ runId, answers }) {
  const ctx = getContextOrThrow(runId);
  ctx.approved = true;
  appendLog(ctx, 3, "Approval received. Starting auto-run for steps 3-5.", false);
  runStepsThreeToFive(ctx, answers);
  return {
    ok: true,
    runId: ctx.runId,
    step: 5,
    llmCallsUsed: ctx.llmCallsUsed,
    maxLlmCalls: MAX_LLM_CALLS,
    theme: { key: ctx.themeLocked, label: THEME_LABELS[ctx.themeLocked] },
    blueprint: ctx.blueprint,
    html: ctx.html,
    logs: ctx.logs,
    status: statusSnapshot(ctx),
  };
}

function getStatus({ runId }) {
  const ctx = getContextOrThrow(runId);
  return {
    ok: true,
    ...statusSnapshot(ctx),
  };
}

function getLogs({ runId }) {
  const ctx = getContextOrThrow(runId);
  return {
    ok: true,
    runId: ctx.runId,
    logs: ctx.logs,
  };
}

function subscribe({ runId, onLog, onStatus }) {
  const ctx = getContextOrThrow(runId);
  const logEvent = `log:${ctx.runId}`;
  const statusEvent = `status:${ctx.runId}`;
  const logHandler = (entry) => onLog && onLog(entry);
  const statusHandler = (entry) => onStatus && onStatus(entry);
  LOG_BUS.on(logEvent, logHandler);
  LOG_BUS.on(statusEvent, statusHandler);
  return () => {
    LOG_BUS.off(logEvent, logHandler);
    LOG_BUS.off(statusEvent, statusHandler);
  };
}

module.exports = {
  analyze,
  generateQuestions,
  approveAndAutoRun,
  getStatus,
  getLogs,
  subscribe,
};
