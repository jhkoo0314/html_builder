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

function buildPromptBundle({
  parsedText,
  title,
  designPrompt,
  creativeEnabled,
  mode,
  purpose,
  maxSourceChars = 0,
}) {
  const rawSource = String(parsedText || "");
  const cap = Number(maxSourceChars || 0);
  const sourceText = cap > 0 ? rawSource.slice(0, cap) : rawSource;
  const prompts = createHtmlPrompts({
    combinedText: sourceText,
    title,
    designPrompt,
    creativeMode: String(creativeEnabled),
    styleMode: mode,
    purposeMode: purpose,
  });
  return {
    prompt: `${prompts.system}\n\n${prompts.user}`,
    sourceLength: sourceText.length,
    sourceHash: shortHash(sourceText),
    promptLength: `${prompts.system}\n\n${prompts.user}`.length,
    promptHash: shortHash(`${prompts.system}\n\n${prompts.user}`),
    truncated: sourceText.length !== rawSource.length,
  };
}

function capModelTimeouts(modelTimeoutsMs, capMs) {
  const limit = Number(capMs || 0);
  if (!Number.isFinite(limit) || limit <= 0) return modelTimeoutsMs || {};
  const source = modelTimeoutsMs || {};
  const next = {};
  for (const [k, v] of Object.entries(source)) {
    const n = Number(v);
    next[k] = Number.isFinite(n) && n > 0 ? Math.min(n, limit) : limit;
  }
  return next;
}

function buildResponse({
  html,
  mode,
  renderMode,
  extractionMethod,
  finalizeApplied,
  repairAttempted,
  whyFallback,
  meta,
  sourceFiles,
  title,
}) {
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

async function generatePipeline({
  files,
  combinedText = "",
  sourceFiles = [],
  designPrompt = "",
  creativeMode,
  styleMode = "normal",
  purposeMode = "general",
}) {
  const started = Date.now();
  const env = getEnv();
  const resolvedSourceFiles =
    Array.isArray(sourceFiles) && sourceFiles.length
      ? sourceFiles
      : (files || []).map((f) => f.originalname);
  let repairAttempted = false;
  const inputMode = String(styleMode || "normal").toLowerCase();
  const mode = inputMode === "extreme" ? "extreme" : (inputMode === "creative" ? "creative" : "normal");
  const purpose = "general";
  const creativeEnabled =
    typeof creativeMode === "boolean"
      ? creativeMode
      : mode !== "normal";
  const isExtreme = mode === "extreme";

  const primaryBudgetProfile = {
    totalBudgetMs: isExtreme ? DEFAULTS.EXTREME_TOTAL_LLM_BUDGET_MS : DEFAULTS.TOTAL_LLM_BUDGET_MS,
    attemptTimeoutMs: isExtreme ? DEFAULTS.EXTREME_ATTEMPT_TIMEOUT_MS : DEFAULTS.ATTEMPT_TIMEOUT_MS,
    minRemainingMs: isExtreme
      ? DEFAULTS.EXTREME_MIN_LLM_REMAINING_BUDGET_MS
      : DEFAULTS.MIN_LLM_REMAINING_BUDGET_MS,
    modelTimeoutsMs: isExtreme && DEFAULTS.EXTREME_MODEL_TIMEOUTS_MS
      ? DEFAULTS.EXTREME_MODEL_TIMEOUTS_MS
      : DEFAULTS.MODEL_TIMEOUTS_MS,
  };

  const compactRetryProfile = {
    totalBudgetMs: isExtreme
      ? DEFAULTS.EXTREME_RETRY_COMPACT_TOTAL_BUDGET_MS
      : DEFAULTS.RETRY_COMPACT_TOTAL_BUDGET_MS,
    attemptTimeoutMs: isExtreme
      ? DEFAULTS.EXTREME_RETRY_COMPACT_ATTEMPT_TIMEOUT_MS
      : DEFAULTS.RETRY_COMPACT_ATTEMPT_TIMEOUT_MS,
    minRemainingMs: isExtreme
      ? DEFAULTS.EXTREME_RETRY_COMPACT_MIN_REMAINING_BUDGET_MS
      : DEFAULTS.RETRY_COMPACT_MIN_REMAINING_BUDGET_MS,
    maxTextChars: isExtreme
      ? DEFAULTS.EXTREME_RETRY_COMPACT_MAX_TEXT_CHARS
      : DEFAULTS.RETRY_COMPACT_MAX_TEXT_CHARS,
  };

  if ((!files || files.length === 0) && !String(combinedText || "").trim()) {
    throw new Error("No documents uploaded.");
  }

  const run = async () => {
    let parsedText = String(combinedText || "");
    if (!parsedText.trim()) {
      const parsed = await extractUploadedTexts(files);
      parsedText = String(parsed.combinedText || "");
    }
    if (!parsedText.trim()) {
      throw Object.assign(new Error("텍스트 추출 실패"), { code: "EMPTY_TEXT" });
    }

    const baseMeta = {
      diagnosticVersion: "obs-v1",
      hasApiKey: Boolean(env.GEMINI_API_KEY),
      llmAttempted: false,
      llmAttempts: [],
      llmRounds: [],
      llmBudgetMs: 0,
      llmAttemptTimeoutMs: 0,
      llmReasonCode: "",
      tinySmokeEnabled: String(process.env.REPORT2SLIDE_TINY_SMOKE || "") === "1",
      llmInputLength: 0,
      llmInputHash: "",
      llmPromptLength: 0,
      llmPromptHash: "",
      fallbackInputLength: 0,
      fallbackInputHash: "",
      ssotInputLength: 0,
      ssotInputHash: "",
      extractionMethodFinal: "none",
      networkDiagnostics: null,
      creativeMode: creativeEnabled,
      styleMode: mode,
      purposeMode: purpose,
      rawLength: 0,
      extractedLength: 0,
      slideCount: 0,
      navLogic: false,
      timings: { totalMs: 0, generateMs: 0, repairMs: 0 },
    };

    function setLlmInputMeta(text) {
      baseMeta.llmInputLength = String(text || "").length;
      baseMeta.llmInputHash = shortHash(text);
      baseMeta.llmPromptLength = baseMeta.llmInputLength;
      baseMeta.llmPromptHash = baseMeta.llmInputHash;
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
      setFallbackInputMeta(parsedText);
      const html = renderHouseFallback({
        title: "Fallback Deck",
        combinedText: parsedText,
        sourceFiles: resolvedSourceFiles,
      });
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
        sourceFiles: resolvedSourceFiles,
        title: "Fallback Deck",
      });
    }

    const cleanDesignPrompt = typeof designPrompt === "string" ? designPrompt.trim() : "";
    const primaryBundle = baseMeta.tinySmokeEnabled
      ? {
          prompt: createTinySmokePrompt(),
          sourceLength: 0,
          sourceHash: "",
          promptLength: createTinySmokePrompt().length,
          promptHash: shortHash(createTinySmokePrompt()),
          truncated: false,
        }
      : buildPromptBundle({
          parsedText,
          title: "Generated Deck",
          designPrompt: cleanDesignPrompt,
          creativeEnabled,
          mode,
          purpose,
        });
    setLlmInputMeta(primaryBundle.prompt);
    if (baseMeta.tinySmokeEnabled) {
      baseMeta.networkDiagnostics = await runNetworkDiagnostics();
    }
    baseMeta.llmAttempted = true;
    const genStart = Date.now();
    const llmRoundSummaries = [];
    const mergedAttempts = [];
    async function runLlmRound({
      roundName,
      bundle,
      totalBudgetMs,
      attemptTimeoutMs,
      minRemainingMs,
      modelTimeoutsMs,
    }) {
      const roundStartedAt = Date.now();
      const roundResult = await runWithModelFallback({
        apiKey: env.GEMINI_API_KEY,
        candidates: DEFAULTS.MODEL_CANDIDATES,
        modelTimeoutsMs,
        prompt: bundle.prompt,
        totalBudgetMs,
        attemptTimeoutMs,
        minRemainingMs,
      });
      const taggedAttempts = (roundResult.attempts || []).map((attempt) => ({
        ...attempt,
        round: roundName,
        promptLength: bundle.promptLength,
        promptHash: bundle.promptHash,
      }));
      mergedAttempts.push(...taggedAttempts);
      llmRoundSummaries.push({
        round: roundName,
        ok: Boolean(roundResult.ok),
        reasonCode: roundResult.ok ? "OK" : (roundResult.reasonCode || "LLM_ERROR"),
        promptLength: bundle.promptLength,
        promptHash: bundle.promptHash,
        sourceLength: bundle.sourceLength,
        sourceHash: bundle.sourceHash,
        truncated: Boolean(bundle.truncated),
        elapsedMs: Date.now() - roundStartedAt,
        attempts: taggedAttempts.length,
        totalBudgetMs,
        attemptTimeoutMs,
      });
      return roundResult;
    }

    let llmResult = await runLlmRound({
      roundName: "primary",
      bundle: primaryBundle,
      totalBudgetMs: primaryBudgetProfile.totalBudgetMs,
      attemptTimeoutMs: primaryBudgetProfile.attemptTimeoutMs,
      minRemainingMs: primaryBudgetProfile.minRemainingMs,
      modelTimeoutsMs: primaryBudgetProfile.modelTimeoutsMs,
    });

    const shouldRetryCompact = Boolean(
      DEFAULTS.RETRY_ON_TIMEOUT_ENABLED &&
      !baseMeta.tinySmokeEnabled &&
      !llmResult.ok &&
      llmResult.reasonCode === "LLM_TIMEOUT"
    );
    if (shouldRetryCompact) {
      const compactBundle = buildPromptBundle({
        parsedText,
        title: "Generated Deck",
        designPrompt: cleanDesignPrompt.slice(0, 1200),
        creativeEnabled,
        mode,
        purpose,
        maxSourceChars: compactRetryProfile.maxTextChars,
      });
      setLlmInputMeta(compactBundle.prompt);
      llmResult = await runLlmRound({
        roundName: "compact-retry",
        bundle: compactBundle,
        totalBudgetMs: compactRetryProfile.totalBudgetMs,
        attemptTimeoutMs: compactRetryProfile.attemptTimeoutMs,
        minRemainingMs: compactRetryProfile.minRemainingMs,
        modelTimeoutsMs: capModelTimeouts(
          primaryBudgetProfile.modelTimeoutsMs,
          compactRetryProfile.attemptTimeoutMs
        ),
      });
    }

    baseMeta.llmAttempts = mergedAttempts;
    baseMeta.llmRounds = llmRoundSummaries;
    baseMeta.llmReasonCode = llmResult.ok ? "OK" : (llmResult.reasonCode || "LLM_ERROR");
    baseMeta.llmBudgetMs = Number(llmResult.budgetMs || 0);
    baseMeta.llmAttemptTimeoutMs = Number(llmResult.attemptTimeoutMs || 0);
    baseMeta.timings.generateMs = Date.now() - genStart;

    if (!llmResult.ok) {
      setFallbackInputMeta(parsedText);
      const html = renderHouseFallback({
        title: "Fallback Deck",
        combinedText: parsedText,
        sourceFiles: resolvedSourceFiles,
      });
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
        sourceFiles: resolvedSourceFiles,
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
      const repairedRaw = await attemptRepair({ env, raw, enabled: true });
      baseMeta.timings.repairMs += Date.now() - repairStartedAt;
      if (repairedRaw) {
        repairAttempted = true;
        const extracted2 = extractHtmlFromText(repairedRaw);
        html = extracted2.html;
        extractionMethod = extracted2.extractionMethod;
      }
    }

    if (!html) {
      setFallbackInputMeta(parsedText);
      const fallback = renderHouseFallback({
        title: "Fallback Deck",
        combinedText: parsedText,
        sourceFiles: resolvedSourceFiles,
      });
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
        sourceFiles: resolvedSourceFiles,
        title: "Fallback Deck",
      });
    }

    const finalized = finalizeHtmlDocument(html);
    const nav = ensureInteractiveDeckHtml(finalized.html);
    const slideCount = countSlides(nav.html);
    baseMeta.slideCount = slideCount;
    baseMeta.navLogic = true;
    baseMeta.extractionMethodFinal = extractionMethod || "none";

    const failedByContract = slideCount < DEFAULTS.MIN_SLIDES_REQUIRED;
    const failedByStrictMeaning = !isMeaningfulHtml(nav.html);
    const needsRepair = creativeEnabled ? failedByContract : (failedByStrictMeaning || failedByContract);

    if (needsRepair) {
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
          baseMeta.extractionMethodFinal =
            repairedExtracted.extractionMethod || extractionMethod || "none";
          const repairedContractOk = slideCount2 >= DEFAULTS.MIN_SLIDES_REQUIRED;
          const repairedMeaningOk = isMeaningfulHtml(nav2.html);
          const repairedAccepted = creativeEnabled
            ? repairedContractOk
            : (repairedMeaningOk && repairedContractOk);
          if (repairedAccepted) {
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
              sourceFiles: resolvedSourceFiles,
              title: "Generated Deck",
            });
          }
        }
      }
      setFallbackInputMeta(parsedText);
      const fallback = renderHouseFallback({
        title: "Fallback Deck",
        combinedText: parsedText,
        sourceFiles: resolvedSourceFiles,
      });
      baseMeta.slideCount = countSlides(fallback);
      baseMeta.timings.totalMs = Date.now() - started;
      return buildResponse({
        html: fallback,
        mode: "fallback-rule-based",
        renderMode: "fallback",
        extractionMethod,
        finalizeApplied: true,
        repairAttempted,
        whyFallback: failedByContract ? "NO_SLIDES" : "LOW_MEANINGFULNESS",
        meta: baseMeta,
        sourceFiles: resolvedSourceFiles,
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
      sourceFiles: resolvedSourceFiles,
      title: "Generated Deck",
    });
  };

  const requestTimeoutMs = isExtreme
    ? Number(DEFAULTS.EXTREME_REQUEST_TIMEOUT_MS || DEFAULTS.REQUEST_TIMEOUT_MS)
    : Number(DEFAULTS.REQUEST_TIMEOUT_MS);
  return withTimeout(run(), requestTimeoutMs, "REQUEST_TIMEOUT");
}

async function attemptRepair({ env, raw, enabled }) {
  if (!enabled || !env.GEMINI_API_KEY) return "";
  const prompt = createRepairPrompt(raw);
  const repaired = await runWithModelFallback({
    apiKey: env.GEMINI_API_KEY,
    candidates: DEFAULTS.MODEL_CANDIDATES,
    modelTimeoutsMs: DEFAULTS.MODEL_TIMEOUTS_MS,
    prompt,
    timeoutMs: DEFAULTS.LLM_REPAIR_TIMEOUT_MS,
  });
  return repaired.ok ? repaired.text : "";
}

module.exports = { generatePipeline };
