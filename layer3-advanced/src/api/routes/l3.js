"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { analyzeDirect, renderDirect } = require("../../l3/twoStep");
const { countSlides } = require("../../html/postprocess/meaningful");
const { L3BuildError } = require("../../l3/errors");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

router.post("/l3/build-direct", upload.array("documents"), async (req, res) => {
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
    try {
      const styleMode = normalizeStyleMode(req.body.styleMode);
      const toneMode = normalizeToneMode(req.body.toneMode);
      const renderStart = Date.now();
      result = await renderDirect({
        analysis: analyzed.analysis,
        combinedText: analyzed.combinedText,
        sourceFiles: analyzed.sourceFiles,
        designPrompt: typeof req.body.designPrompt === "string" ? req.body.designPrompt : "",
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
    const navLogic = variantMeta.navLogic !== false;
    const designQuality = evaluateDesignQuality({
      html,
      slideCount: effectiveSlideCount,
      navLogic,
      warnings: Array.isArray(variantMeta.warnings) ? variantMeta.warnings : [],
    });
    const isFallback = variant.renderMode === "fallback" || result.mode === "fallback-rule-based";
    const status = designQuality.status;
    const whyFallback = isFallback ? (variant.whyFallback || "UNKNOWN") : "N/A";

    const meta = {
      runId,
      mode: "direct",
      status,
      creativeMode: variantMeta.creativeMode === true,
      styleMode: variantMeta.styleMode || "normal",
      toneMode: variantMeta.toneMode || "auto",
      purposeMode: "general",
      slideCount: effectiveSlideCount,
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
    };

    const attemptSummary = summarizeAttempts(meta.llmAttempts);
    console.info("[l3.build-direct]", JSON.stringify({
      runId,
      status,
      styleMode: meta.styleMode,
      creativeMode: meta.creativeMode,
      slideCount: meta.slideCount,
      whyFallback,
      llmReasonCode: variantMeta.llmReasonCode || "",
      llmRounds: Array.isArray(variantMeta.llmRounds) ? variantMeta.llmRounds : [],
      attemptSummary,
      timings: meta.timings,
    }));

    return res.json({
      ok: true,
      runId,
      mode: "direct",
      status,
      styleMode: meta.styleMode,
      toneMode: meta.toneMode,
      purposeMode: "general",
      html,
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
});

module.exports = {
  router,
};
