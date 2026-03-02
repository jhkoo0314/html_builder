"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { analyzeDirect, renderDirect } = require("../../l3/twoStep");
const { countSlides } = require("../../html/postprocess/meaningful");
const { L3BuildError } = require("../../l3/errors");
const { getEnv } = require("../../config/env");
const { runWithModelFallback } = require("../../llm/gemini/client");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const SLIDE_TYPES = [
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
const RUN_THEME_SET = {
  A: {
    label: "Signature Premium",
    designPrompt: "Theme A Signature Premium: cinematic premium mood, bold hero moments, rich gradient backdrops, elegant typographic contrast, high visual drama.",
  },
  B: {
    label: "Enterprise Swiss",
    designPrompt: "Theme B Enterprise Swiss: strict grid, strong information hierarchy, clean corporate look, restrained palette, executive report clarity.",
  },
  C: {
    label: "Minimal Keynote",
    designPrompt: "Theme C Minimal Keynote: minimalist whitespace-first composition, concise typography, calm tempo, reduced ornaments, keynote-like simplicity.",
  },
  D: {
    label: "Analytical Dashboard",
    designPrompt: "Theme D Analytical Dashboard: data-centric dashboard style, card systems, metrics-first storytelling, operational readability, analytical focus.",
  },
  E: {
    label: "Deep Tech Dark",
    designPrompt: "Theme E Deep Tech Dark: deep dark canvas, neon accents, futuristic technical mood, high contrast interfaces, advanced technology narrative.",
  },
};

function normalizeStyleMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "extreme") return "extreme";
  if (mode === "creative") return "creative";
  return "normal";
}

function normalizeToneMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return "auto";
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

function selectThemeByHeuristic(analysis) {
  const text = `${analysis && analysis.docSummary ? analysis.docSummary : ""} ${(analysis && analysis.headings || []).join(" ")}`.toLowerCase();
  const headingCount = Number(analysis && analysis.stats && analysis.stats.headingCount);
  if (/\b(ai|tech|platform|security|architecture|infra|llm)\b/.test(text)) return "E";
  if (/\b(kpi|metric|roi|performance|conversion|dashboard|report)\b/.test(text)) return "D";
  if (/\b(board|executive|strategy|enterprise|b2b)\b/.test(text)) return "B";
  if (headingCount <= 2) return "C";
  return "A";
}

function buildThemeSelectorPrompt(analysis) {
  const headings = Array.isArray(analysis && analysis.headings) ? analysis.headings.slice(0, 12) : [];
  return [
    "You are a theme selector for slide generation.",
    "Choose exactly one theme key from: A, B, C, D, E.",
    "Return JSON only.",
    "Schema: {\"theme\":\"A|B|C|D|E\",\"reason\":\"string\"}",
    "Keep reason concise and in Korean.",
    "",
    "Theme guide:",
    "A Signature Premium: premium cinematic storytelling.",
    "B Enterprise Swiss: clean corporate reporting style.",
    "C Minimal Keynote: minimal and whitespace-first.",
    "D Analytical Dashboard: data-heavy dashboard style.",
    "E Deep Tech Dark: dark technical futuristic style.",
    "",
    "Document analysis:",
    JSON.stringify({
      docTitle: analysis && analysis.docTitle ? analysis.docTitle : "",
      docSummary: analysis && analysis.docSummary ? analysis.docSummary : "",
      headings,
      stats: analysis && analysis.stats ? analysis.stats : {},
    }),
  ].join("\n");
}

async function chooseRunTheme(analysis) {
  const env = getEnv();
  const fallbackTheme = selectThemeByHeuristic(analysis);
  if (!env.GEMINI_API_KEY) {
    return {
      key: fallbackTheme,
      label: RUN_THEME_SET[fallbackTheme].label,
      reason: "API key missing, heuristic theme selection used.",
      source: "heuristic",
      llmReasonCode: "NO_API_KEY",
    };
  }
  const llmResult = await runWithModelFallback({
    apiKey: env.GEMINI_API_KEY,
    candidates: ["gemini-3-flash-preview", "gemini-2.5-flash"],
    prompt: buildThemeSelectorPrompt(analysis),
    totalBudgetMs: 45000,
    attemptTimeoutMs: 25000,
    minRemainingMs: 2500,
    modelTimeoutsMs: {
      "gemini-3-flash-preview": 20000,
      "gemini-2.5-flash": 25000,
    },
  });
  if (!llmResult.ok) {
    return {
      key: fallbackTheme,
      label: RUN_THEME_SET[fallbackTheme].label,
      reason: `LLM theme selection failed: ${llmResult.reasonCode || "LLM_ERROR"}; heuristic fallback used.`,
      source: "heuristic-fallback",
      llmReasonCode: llmResult.reasonCode || "LLM_ERROR",
    };
  }
  const json = parseJsonFromText(llmResult.text);
  const candidate = String(json && json.theme ? json.theme : "").toUpperCase();
  const key = RUN_THEME_SET[candidate] ? candidate : fallbackTheme;
  return {
    key,
    label: RUN_THEME_SET[key].label,
    reason: String(json && json.reason ? json.reason : "문서 성격에 맞는 테마를 선택했습니다."),
    source: "llm",
    llmReasonCode: "OK",
  };
}

function evaluateDesignQuality({ html, slideCount, navLogic, warnings }) {
  const mergedWarnings = Array.isArray(warnings) ? warnings.slice() : [];
  if (!navLogic) mergedWarnings.push("NAV_LOGIC_MISSING");
  if (slideCount >= 31 && slideCount <= 45) mergedWarnings.push("HIGH_SLIDE_COUNT_WARN");
  if (slideCount >= 46) mergedWarnings.push("SLIDE_COUNT_TOO_HIGH");

  if (!String(html || "").trim()) {
    return { status: "FAIL-DESIGN", warnings: mergedWarnings, reason: "EMPTY_HTML" };
  }
  if (slideCount <= 1 || slideCount >= 46) {
    return { status: "FAIL-DESIGN", warnings: mergedWarnings, reason: "SLIDE_COUNT_OUT_OF_RANGE" };
  }
  if (slideCount >= 31) {
    return { status: "PASS-WARN", warnings: mergedWarnings, reason: "HIGH_SLIDE_COUNT" };
  }
  if (mergedWarnings.length > 0) {
    return { status: "PASS-WARN", warnings: mergedWarnings, reason: "WARNINGS_PRESENT" };
  }
  return { status: "PASS-DESIGN", warnings: mergedWarnings, reason: "OK" };
}

function summarizeAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const totals = { total: list.length, ok: 0, failed: 0 };
  const byReason = {};
  for (const item of list) {
    if (item && item.ok) totals.ok += 1;
    else totals.failed += 1;
    const reason = item && item.reasonCode ? item.reasonCode : (item && item.ok ? "OK" : "UNKNOWN");
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return { totals, byReason };
}

function normalizeSlideType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return SLIDE_TYPES.includes(raw) ? raw : "";
}

function assignSlideTypes(slideCount, slidePlan) {
  const plan = Array.isArray(slidePlan) ? slidePlan : [];
  const assigned = [];
  const uniqueFront = Math.min(Number(slideCount || 0), SLIDE_TYPES.length);

  // For decks up to 12 slides, guarantee one-pass coverage of the 12-type set order.
  // This prevents repeated "insight" style dominance when hints are weak.
  for (let i = 0; i < uniqueFront; i += 1) {
    assigned.push(SLIDE_TYPES[i]);
  }

  for (let i = 0; i < slideCount; i += 1) {
    if (i < uniqueFront) {
      const hinted = normalizeSlideType(plan[i] && plan[i].slideTypeHint);
      if (hinted) assigned[i] = hinted;
      continue;
    }
    const fromPlan = normalizeSlideType(plan[i] && plan[i].slideTypeHint);
    if (fromPlan) {
      assigned.push(fromPlan);
      continue;
    }
    assigned.push(SLIDE_TYPES[i % SLIDE_TYPES.length]);
  }
  return assigned;
}

function applySlideTypeAttributes(html, assignedTypes) {
  const types = Array.isArray(assignedTypes) ? assignedTypes : [];
  let index = 0;
  const out = String(html || "").replace(/<section\b([^>]*)>/gi, (full, attrsRaw) => {
    const attrs = String(attrsRaw || "");
    if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(attrs)) return full;
    const type = types[index] || SLIDE_TYPES[index % SLIDE_TYPES.length];
    index += 1;
    const classWithType = attrs.replace(
      /\bclass\s*=\s*["']([^"']*)["']/i,
      (_m, cls) => {
        const tokens = String(cls || "")
          .split(/\s+/)
          .filter(Boolean)
          .filter((t) => !/^type-/.test(t));
        tokens.push(`type-${type}`);
        return `class="${tokens.join(" ")}"`;
      }
    );
    const noDataType = classWithType.replace(/\sdata-slide-type\s*=\s*["'][^"']*["']/gi, "");
    return `<section${noDataType} data-slide-type="${type}">`;
  });
  return { html: out, appliedCount: index };
}

async function handleBuild(req, res, buildMode) {
  try {
    const startedAt = Date.now();
    const files = req.files || [];
    if (!files.length) {
      throw new L3BuildError("INVALID_INPUT", "No documents uploaded.", 400);
    }

    const runId = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    let analyzed;
    let analyzeMs = 0;
    try {
      const analyzeStart = Date.now();
      analyzed = await analyzeDirect({ files });
      analyzeMs = Date.now() - analyzeStart;
    } catch (error) {
      if (error instanceof L3BuildError) throw error;
      throw new L3BuildError("ANALYZE_FAILED", error.message || "Analyze failed", 500);
    }

    let result;
    let renderMs = 0;
    let runTheme = null;
    try {
      const isRunMode = buildMode === "run";
      const styleMode = isRunMode ? "creative" : normalizeStyleMode(req.body.styleMode);
      const toneMode = isRunMode ? "auto" : normalizeToneMode(req.body.toneMode);
      const renderStart = Date.now();
      if (isRunMode) {
        runTheme = await chooseRunTheme(analyzed.analysis);
      }
      const runThemePrompt = runTheme
        ? [
          `Run mode theme lock: ${runTheme.key} (${runTheme.label}).`,
          RUN_THEME_SET[runTheme.key].designPrompt,
          `Theme rationale: ${runTheme.reason}`,
          "Apply this theme consistently across all slides.",
        ].join("\n")
        : "";
      result = await renderDirect({
        analysis: analyzed.analysis,
        combinedText: analyzed.combinedText,
        sourceFiles: analyzed.sourceFiles,
        designPrompt: [
          runThemePrompt,
          isRunMode ? "" : (typeof req.body.designPrompt === "string" ? req.body.designPrompt : ""),
        ]
          .filter(Boolean)
          .join("\n"),
        styleMode,
        toneMode,
        purposeMode: "general",
      });
      renderMs = Date.now() - renderStart;
    } catch (error) {
      if (error instanceof L3BuildError) throw error;
      throw new L3BuildError("RENDER_FAILED", error.message || "Render failed", 500);
    }
    const html = result.html || "";
    if (!html.trim()) {
      throw new L3BuildError("RENDER_FAILED", "Pipeline returned empty html.", 500);
    }

    const variant = (result.htmlVariants && result.htmlVariants[0]) || {};
    const variantMeta = variant.meta || {};
    const timings = variantMeta.timings || {};
    const effectiveSlideCount =
      Number.isFinite(Number(variantMeta.slideCount)) && Number(variantMeta.slideCount) > 0
        ? Number(variantMeta.slideCount)
        : countSlides(html);
    const assignedTypes = assignSlideTypes(effectiveSlideCount, analyzed.analysis && analyzed.analysis.slidePlan);
    const typed = applySlideTypeAttributes(html, assignedTypes);
    const typedHtml = typed.html;
    const navLogic = variantMeta.navLogic !== false;
    const designQuality = evaluateDesignQuality({
      html: typedHtml,
      slideCount: effectiveSlideCount,
      navLogic,
      warnings: Array.isArray(variantMeta.warnings) ? variantMeta.warnings : [],
    });
    const isFallback = variant.renderMode === "fallback" || result.mode === "fallback-rule-based";
    const status = designQuality.status;
    const whyFallback = isFallback ? (variant.whyFallback || "UNKNOWN") : "N/A";

    const meta = {
      runId,
      mode: buildMode,
      status,
      creativeMode: buildMode === "run" ? false : (variantMeta.creativeMode === true),
      styleMode: buildMode === "run" ? "off" : (variantMeta.styleMode || "normal"),
      toneMode: buildMode === "run" ? "off" : (variantMeta.toneMode || "auto"),
      purposeMode: "general",
      slideCount: effectiveSlideCount,
      slideTypes: assignedTypes,
      timings: {
        analyzeMs,
        renderMs,
        totalMs: Date.now() - startedAt,
        generateMs: Number(timings.generateMs || 0),
        repairMs: Number(timings.repairMs || 0),
      },
      whyFallback,
      llmAttempts: Array.isArray(variantMeta.llmAttempts) ? variantMeta.llmAttempts : [],
      stats: {
        extractedLength: Number(variantMeta.extractedLength || 0),
        headingCount: Number.isFinite(Number(variantMeta.headingCount))
          ? Number(variantMeta.headingCount)
          : null,
        slideCount: effectiveSlideCount,
      },
      warnings: designQuality.warnings,
      qualityReason: designQuality.reason,
      theme: runTheme
        ? {
          key: runTheme.key,
          label: runTheme.label,
          reason: runTheme.reason,
          source: runTheme.source,
          llmReasonCode: runTheme.llmReasonCode,
        }
        : null,
      runStages: buildMode === "run"
        ? [
          "1/4 analyze",
          "2/4 llm-theme-select",
          "3/4 llm-generate",
          "4/4 quality-check",
        ]
        : null,
    };

    const attemptSummary = summarizeAttempts(meta.llmAttempts);
    console.info("[l3.build-direct]", JSON.stringify({
      runId,
      mode: buildMode,
      status,
      styleMode: meta.styleMode,
      creativeMode: buildMode === "run" ? false : meta.creativeMode,
      slideCount: meta.slideCount,
      whyFallback,
      theme: meta.theme,
      llmReasonCode: variantMeta.llmReasonCode || "",
      llmRounds: Array.isArray(variantMeta.llmRounds) ? variantMeta.llmRounds : [],
      attemptSummary,
      timings: meta.timings,
    }));

    return res.json({
      ok: true,
      runId,
      mode: buildMode,
      status,
      styleMode: meta.styleMode,
      toneMode: meta.toneMode,
      purposeMode: "general",
      theme: meta.theme,
      html: typedHtml,
      whyFallback,
      llmAttempts: meta.llmAttempts,
      analysis: analyzed.analysis,
      htmlVariants: [
        {
          id: "v1",
          renderMode: isFallback ? "fallback" : "llm",
          referenceUsed: false,
          extractionMethod: variant.extractionMethod || "llm",
          finalizeApplied: variant.finalizeApplied !== false,
          repairAttempted: Boolean(variant.repairAttempted),
          whyFallback: meta.whyFallback,
          score: null,
          scoreBreakdown: {},
          meta,
          runId,
        },
      ],
    });
  } catch (error) {
    const status = error instanceof L3BuildError ? error.status : 500;
    const code = error instanceof L3BuildError ? error.code : "RENDER_FAILED";
    return res.status(status).json({
      ok: false,
      error: code,
      message: error.message,
    });
  }
}

router.post("/l3/build-direct", upload.array("documents"), async (req, res) => {
  return handleBuild(req, res, "step");
});

router.post("/l3/build-from-run", upload.array("documents"), async (req, res) => {
  return handleBuild(req, res, "run");
});

module.exports = {
  router,
};
