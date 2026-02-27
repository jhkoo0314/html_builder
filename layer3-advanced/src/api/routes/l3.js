"use strict";

const express = require("express");
const multer = require("multer");
const { generatePipeline } = require("../../pipelines/generatePipeline");
const { countSlides } = require("../../html/postprocess/meaningful");
const {
  ensureArtifactsRoot,
  createRunId,
  writeLayer3Artifacts,
  toPublicPath,
} = require("../../l3/artifacts");
const { L3BuildError } = require("../../l3/errors");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/l3/build-direct", upload.array("documents"), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      throw new L3BuildError("INVALID_INPUT", "No documents uploaded.", 400);
    }

    const artifactsRoot = ensureArtifactsRoot(process.env.ARTIFACTS_ROOT);
    const runId = createRunId();
    const result = await generatePipeline({
      files,
      designPrompt: typeof req.body.designPrompt === "string" ? req.body.designPrompt : "",
      creativeMode: true,
      styleMode: String(req.body.styleMode || "creative"),
      purposeMode: String(req.body.purposeMode || "general"),
    });
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
    const isFallback = variant.renderMode === "fallback" || result.mode === "fallback-rule-based";
    const status = isFallback ? "FALLBACK" : "SUCCESS";
    const whyFallback = isFallback ? (variant.whyFallback || "UNKNOWN") : "N/A";

    const meta = {
      runId,
      mode: "direct",
      status,
      creativeMode: variantMeta.creativeMode === true,
      styleMode: variantMeta.styleMode || "creative",
      purposeMode: variantMeta.purposeMode || "general",
      slideCount: effectiveSlideCount,
      timings: {
        totalMs: Number(timings.totalMs || 0),
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
      warnings: Array.isArray(variantMeta.warnings) ? variantMeta.warnings : [],
    };

    const saved = writeLayer3Artifacts({
      artifactsRoot,
      runId,
      html,
      meta,
    });

    return res.json({
      ok: true,
      runId,
      mode: "direct",
      status,
      styleMode: meta.styleMode,
      purposeMode: meta.purposeMode,
      html,
      whyFallback,
      llmAttempts: meta.llmAttempts,
      artifacts: {
        analysis: saved.analysisPath ? toPublicPath(saved.analysisPath, artifactsRoot) : null,
        deck: toPublicPath(saved.deckPath, artifactsRoot),
        meta: toPublicPath(saved.metaPath, artifactsRoot),
      },
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
