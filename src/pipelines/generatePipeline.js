"use strict";

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
      hasApiKey: Boolean(env.GEMINI_API_KEY),
      llmAttempted: false,
      llmAttempts: [],
      rawLength: 0,
      extractedLength: 0,
      slideCount: 0,
      navLogic: false,
      timings: { totalMs: 0, generateMs: 0, repairMs: 0 },
    };

    if (!env.GEMINI_API_KEY) {
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
    baseMeta.llmAttempted = true;
    const genStart = Date.now();
    const llmResult = await runWithModelFallback({
      apiKey: env.GEMINI_API_KEY,
      candidates: DEFAULTS.MODEL_CANDIDATES,
      prompt: `${prompts.system}\n\n${prompts.user}`,
      timeoutMs: DEFAULTS.LLM_GENERATE_TIMEOUT_MS,
    });
    baseMeta.llmAttempts = llmResult.attempts || [];
    baseMeta.timings.generateMs = Date.now() - genStart;

    if (!llmResult.ok) {
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
      const repairedRaw = await attemptRepair({ env, raw, parsedText: parsed.combinedText, enabled: true });
      if (repairedRaw) {
        repairAttempted = true;
        const extracted2 = extractHtmlFromText(repairedRaw);
        html = extracted2.html;
        extractionMethod = extracted2.extractionMethod;
      }
    }

    if (!html) {
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

    if (!isMeaningfulHtml(nav.html) || slideCount < DEFAULTS.MIN_SLIDES_REQUIRED) {
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
    prompt,
    timeoutMs: DEFAULTS.LLM_REPAIR_TIMEOUT_MS,
  });
  void repairStart;
  return repaired.ok ? repaired.text : "";
}

module.exports = { generatePipeline };
