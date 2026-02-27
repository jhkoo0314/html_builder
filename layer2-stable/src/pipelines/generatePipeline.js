"use strict";

const crypto = require("crypto");
const { DEFAULTS } = require("../config/defaults");
const { getEnv } = require("../config/env");
const { extractUploadedTexts } = require("../parsers");
const { runWithModelFallback, withTimeout } = require("../llm/gemini/client");
const { createHtmlPrompts, createRepairPrompt } = require("../llm/gemini/prompts/htmlPrompts");
const { extractHtmlFromText } = require("../html/extract/extractHtmlFromText");
const { finalizeHtmlDocument } = require("../html/finalize/finalizeHtmlDocument");
const { countSlides, isMeaningfulHtml } = require("../html/postprocess/meaningful");
const { ensureInteractiveDeckHtml } = require("../html/postprocess/navigation");
const { renderHouseFallback } = require("../html/fallback/houseRenderer");
const { runNetworkDiagnostics } = require("../diagnostics/network");

function shortHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 12);
}

function createTinySmokePrompt() {
  return [
    "You are a presentation HTML generator.",
    "Return complete HTML only (doctype/html/head/body).",
    "Create a minimal 2-slide deck with <section class=\"slide\">.",
    "Ensure first slide is visible and include Prev/Next + keyboard navigation.",
    "Include print CSS page-break per slide.",
    "",
    "Title: Smoke Test",
    "",
    "Source text:",
    "This is a deterministic tiny smoke payload for connectivity diagnostics.",
  ].join("\n");
}

function buildResponse({ html, mode, renderMode, extractionMethod, finalizeApplied, repairAttempted, whyFallback, meta, sourceFiles, title }) {
  return {
    mode,
    sourceFiles,
    title,
    design: { style: DEFAULTS.HOUSE_STYLE_ID },
    html,
    htmlVariants: [
      {
        id: "v1",
        renderMode,
        referenceUsed: false,
        extractionMethod,
        finalizeApplied,
        repairAttempted,
        whyFallback: whyFallback || "",
        score: renderMode === "fallback" ? null : 0,
        scoreBreakdown: {},
        meta,
      },
    ],
    variantRequested: 1,
    variantProduced: 1,
    workflowUsed: DEFAULTS.WORKFLOW,
    referenceModeUsed: DEFAULTS.REFERENCE_MODE,
  };
}

async function generatePipeline({ files }) {
  const started = Date.now();
  const env = getEnv();
  const sourceFiles = (files || []).map((f) => f.originalname);
  let repairAttempted = false;

  if (!files || files.length === 0) {
    throw new Error("No documents uploaded.");
  }

  const run = async () => {
    const parsed = await extractUploadedTexts(files);
    if (!parsed.combinedText.trim()) {
      throw Object.assign(new Error("텍스트 추출 실패"), { code: "EMPTY_TEXT" });
    }

    const baseMeta = {
      diagnosticVersion: "obs-v1",
      hasApiKey: Boolean(env.GEMINI_API_KEY),
      llmAttempted: false,
      llmAttempts: [],
      llmBudgetMs: 0,
      llmAttemptTimeoutMs: 0,
      tinySmokeEnabled: String(process.env.REPORT2SLIDE_TINY_SMOKE || "") === "1",
      llmInputLength: 0,
      llmInputHash: "",
      fallbackInputLength: 0,
      fallbackInputHash: "",
      ssotInputLength: 0,
      ssotInputHash: "",
      extractionMethodFinal: "none",
      networkDiagnostics: null,
      // Keep legacy semantics for compatibility with existing dashboards.
      rawLength: 0,
      extractedLength: 0,
      slideCount: 0,
      navLogic: false,
      timings: { totalMs: 0, generateMs: 0, repairMs: 0 },
    };
    function setLlmInputMeta(text) {
      baseMeta.llmInputLength = String(text || "").length;
      baseMeta.llmInputHash = shortHash(text);
      baseMeta.ssotInputLength = baseMeta.llmInputLength;
      baseMeta.ssotInputHash = baseMeta.llmInputHash;
      baseMeta.extractionMethodFinal = "llm-prompt";
    }
    function setFallbackInputMeta(text) {
      baseMeta.fallbackInputLength = String(text || "").length;
      baseMeta.fallbackInputHash = shortHash(text);
      baseMeta.ssotInputLength = baseMeta.fallbackInputLength;
      baseMeta.ssotInputHash = baseMeta.fallbackInputHash;
      baseMeta.extractionMethodFinal = "fallback-input";
    }

    if (!env.GEMINI_API_KEY) {
      setFallbackInputMeta(parsed.combinedText);
      const html = renderHouseFallback({ title: "Fallback Deck", combinedText: parsed.combinedText, sourceFiles });
      baseMeta.slideCount = countSlides(html);
      baseMeta.timings.totalMs = Date.now() - started;
      return buildResponse({
        html,
        mode: "fallback-rule-based",
        renderMode: "fallback",
        extractionMethod: "none",
        finalizeApplied: true,
        repairAttempted,
        whyFallback: "NO_API_KEY",
        meta: baseMeta,
        sourceFiles,
        title: "Fallback Deck",
      });
    }

    const prompts = createHtmlPrompts({ combinedText: parsed.combinedText, title: "Generated Deck" });
    const llmPrompt = baseMeta.tinySmokeEnabled
      ? createTinySmokePrompt()
      : `${prompts.system}\n\n${prompts.user}`;
    setLlmInputMeta(llmPrompt);
    if (baseMeta.tinySmokeEnabled) {
      baseMeta.networkDiagnostics = await runNetworkDiagnostics();
    }
    baseMeta.llmAttempted = true;
    const genStart = Date.now();
    const llmResult = await runWithModelFallback({
      apiKey: env.GEMINI_API_KEY,
      candidates: DEFAULTS.MODEL_CANDIDATES,
      modelTimeoutsMs: DEFAULTS.MODEL_TIMEOUTS_MS,
      prompt: llmPrompt,
      totalBudgetMs: DEFAULTS.TOTAL_LLM_BUDGET_MS,
      attemptTimeoutMs: DEFAULTS.ATTEMPT_TIMEOUT_MS,
      minRemainingMs: DEFAULTS.MIN_LLM_REMAINING_BUDGET_MS,
    });
    baseMeta.llmAttempts = llmResult.attempts || [];
    baseMeta.llmBudgetMs = Number(llmResult.budgetMs || 0);
    baseMeta.llmAttemptTimeoutMs = Number(llmResult.attemptTimeoutMs || 0);
    baseMeta.timings.generateMs = Date.now() - genStart;

    if (!llmResult.ok) {
      setFallbackInputMeta(parsed.combinedText);
      const html = renderHouseFallback({ title: "Fallback Deck", combinedText: parsed.combinedText, sourceFiles });
      baseMeta.slideCount = countSlides(html);
      baseMeta.timings.totalMs = Date.now() - started;
      return buildResponse({
        html,
        mode: "fallback-rule-based",
        renderMode: "fallback",
        extractionMethod: "none",
        finalizeApplied: true,
        repairAttempted,
        whyFallback: llmResult.reasonCode || "LLM_ERROR",
        meta: baseMeta,
        sourceFiles,
        title: "Fallback Deck",
      });
    }

    const raw = llmResult.text || "";
    const extracted = extractHtmlFromText(raw);
    baseMeta.rawLength = raw.length;
    baseMeta.extractedLength = extracted.html.length;

    let html = extracted.html;
    let extractionMethod = extracted.extractionMethod;

    if (!html) {
      const repairStartedAt = Date.now();
      const repairedRaw = await attemptRepair({ env, raw, parsedText: parsed.combinedText, enabled: true });
      baseMeta.timings.repairMs += Date.now() - repairStartedAt;
      if (repairedRaw) {
        repairAttempted = true;
        const extracted2 = extractHtmlFromText(repairedRaw);
        html = extracted2.html;
        extractionMethod = extracted2.extractionMethod;
      }
    }

    if (!html) {
      setFallbackInputMeta(parsed.combinedText);
      const fallback = renderHouseFallback({ title: "Fallback Deck", combinedText: parsed.combinedText, sourceFiles });
      baseMeta.slideCount = countSlides(fallback);
      baseMeta.timings.totalMs = Date.now() - started;
      return buildResponse({
        html: fallback,
        mode: "fallback-rule-based",
        renderMode: "fallback",
        extractionMethod: extractionMethod || "none",
        finalizeApplied: true,
        repairAttempted,
        whyFallback: "EXTRACTION_NONE",
        meta: baseMeta,
        sourceFiles,
        title: "Fallback Deck",
      });
    }

    const finalized = finalizeHtmlDocument(html);
    const nav = ensureInteractiveDeckHtml(finalized.html);
    const slideCount = countSlides(nav.html);
    baseMeta.slideCount = slideCount;
    baseMeta.navLogic = true;
    baseMeta.extractionMethodFinal = extractionMethod || "none";

    if (!isMeaningfulHtml(nav.html) || slideCount < DEFAULTS.MIN_SLIDES_REQUIRED) {
      if (!repairAttempted) {
        repairAttempted = true;
        const repairStartedAt = Date.now();
        const repairedRaw = await attemptRepair({ env, raw: nav.html, enabled: true });
        baseMeta.timings.repairMs += Date.now() - repairStartedAt;
        if (repairedRaw) {
          const repairedExtracted = extractHtmlFromText(repairedRaw);
          const repairedHtml = repairedExtracted.html || repairedRaw;
          const finalized2 = finalizeHtmlDocument(repairedHtml);
          const nav2 = ensureInteractiveDeckHtml(finalized2.html);
          const slideCount2 = countSlides(nav2.html);
          baseMeta.slideCount = slideCount2;
          baseMeta.navLogic = true;
          baseMeta.extractionMethodFinal = repairedExtracted.extractionMethod || extractionMethod || "none";
          if (isMeaningfulHtml(nav2.html) && slideCount2 >= DEFAULTS.MIN_SLIDES_REQUIRED) {
            baseMeta.timings.totalMs = Date.now() - started;
            return buildResponse({
              html: nav2.html,
              mode: "llm-gemini",
              renderMode: "repair",
              extractionMethod: repairedExtracted.extractionMethod || extractionMethod,
              finalizeApplied: finalized2.finalizeApplied,
              repairAttempted,
              whyFallback: "",
              meta: baseMeta,
              sourceFiles,
              title: "Generated Deck",
            });
          }
        }
      }
      setFallbackInputMeta(parsed.combinedText);
      const fallback = renderHouseFallback({ title: "Fallback Deck", combinedText: parsed.combinedText, sourceFiles });
      baseMeta.slideCount = countSlides(fallback);
      baseMeta.timings.totalMs = Date.now() - started;
      return buildResponse({
        html: fallback,
        mode: "fallback-rule-based",
        renderMode: "fallback",
        extractionMethod,
        finalizeApplied: true,
        repairAttempted,
        whyFallback: "NO_SLIDES",
        meta: baseMeta,
        sourceFiles,
        title: "Fallback Deck",
      });
    }

    baseMeta.timings.totalMs = Date.now() - started;
    return buildResponse({
      html: nav.html,
      mode: "llm-gemini",
      renderMode: repairAttempted ? "repair" : "llm",
      extractionMethod,
      finalizeApplied: finalized.finalizeApplied,
      repairAttempted,
      whyFallback: "",
      meta: baseMeta,
      sourceFiles,
      title: "Generated Deck",
    });
  };

  return withTimeout(run(), DEFAULTS.REQUEST_TIMEOUT_MS, "REQUEST_TIMEOUT");
}

async function attemptRepair({ env, raw, enabled }) {
  if (!enabled || !env.GEMINI_API_KEY) return "";
  const prompt = createRepairPrompt(raw);
  const repairStart = Date.now();
  const repaired = await runWithModelFallback({
    apiKey: env.GEMINI_API_KEY,
    candidates: DEFAULTS.MODEL_CANDIDATES,
    modelTimeoutsMs: DEFAULTS.MODEL_TIMEOUTS_MS,
    prompt,
    timeoutMs: DEFAULTS.LLM_REPAIR_TIMEOUT_MS,
  });
  void repairStart;
  return repaired.ok ? repaired.text : "";
}

module.exports = { generatePipeline };
