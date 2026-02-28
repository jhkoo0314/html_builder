"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { analyzeDirect, renderDirect } = require("../../l3/twoStep");
const { countSlides } = require("../../html/postprocess/meaningful");
const { L3BuildError } = require("../../l3/errors");

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

function enforceTypeVisualContract(html) {
  const css = `
/* step3-type-contract: make slide types visibly distinct */
section.slide.type-title-cover{background:linear-gradient(145deg,#0f172a,#1e293b)!important;color:#f8fafc!important;padding:64px!important}
section.slide.type-title-cover h1,section.slide.type-title-cover h2{font-size:clamp(36px,5vw,64px)!important;letter-spacing:-.02em}
section.slide.type-agenda{background:#f8fafc!important;border-left:14px solid #0f766e!important}
section.slide.type-section-divider{display:grid!important;place-items:center!important;text-align:center!important;background:linear-gradient(180deg,#ecfeff,#e0f2fe)!important}
section.slide.type-executive-summary{background:#ffffff!important;border-top:10px solid #1d4ed8!important}
section.slide.type-problem-statement{background:#fff7ed!important;border-left:14px solid #ea580c!important}
section.slide.type-insight{background:#f0fdf4!important;border-left:14px solid #16a34a!important}
section.slide.type-kpi-snapshot{background:#eff6ff!important;border-left:14px solid #2563eb!important}
section.slide.type-comparison{display:grid!important;grid-template-columns:1fr 1fr!important;gap:18px!important;background:#f8fafc!important}
section.slide.type-process-flow{background:#f5f3ff!important;border-left:14px solid #7c3aed!important}
section.slide.type-timeline-roadmap{background:#f0f9ff!important;border-left:14px solid #0891b2!important}
section.slide.type-option-recommendation{background:#fafaf9!important;border-left:14px solid #0f766e!important}
section.slide.type-action-plan{background:#ecfdf5!important;border-left:14px solid #15803d!important}
section.slide[class*="type-"] h1,section.slide[class*="type-"] h2,section.slide[class*="type-"] h3{margin-top:0!important}
`;
  const src = String(html || "");
  if (!src.trim()) return src;
  if (/<style[^>]*id=["']step3-type-contract["']/i.test(src)) return src;
  if (/<\/head>/i.test(src)) {
    return src.replace(/<\/head>/i, `<style id="step3-type-contract">${css}</style></head>`);
  }
  return `${src}\n<style id="step3-type-contract">${css}</style>`;
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function firstMatch(html, re) {
  const m = String(html || "").match(re);
  return m ? stripTags(m[1] || "") : "";
}

function manyMatches(html, re, limit = 6) {
  const out = [];
  let m;
  const source = String(html || "");
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = rx.exec(source)) && out.length < limit) {
    const t = stripTags(m[1] || "");
    if (t) out.push(t);
  }
  return out;
}

function htmlToStep3Outline(rawHtml, fileName) {
  const html = String(rawHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const sectionBlocks = [];
  const sectionRe = /<section\b([\s\S]*?)>([\s\S]*?)<\/section>/gi;
  let m;
  while ((m = sectionRe.exec(html))) {
    const attrs = String(m[1] || "");
    const body = String(m[2] || "");
    if (!/\bslide\b/i.test(attrs)) continue;
    const typeHint = firstMatch(attrs, /data-slide-type\s*=\s*["']([^"']+)["']/i);
    const title = firstMatch(body, /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const bullets = manyMatches(body, /<li[^>]*>([\s\S]*?)<\/li>/gi, 5);
    const paras = manyMatches(body, /<p[^>]*>([\s\S]*?)<\/p>/gi, 3);
    const fallback = stripTags(body).slice(0, 220);
    sectionBlocks.push({ typeHint, title, bullets, paras, fallback });
  }

  const blocks = sectionBlocks.length
    ? sectionBlocks
    : [{
        typeHint: "",
        title: firstMatch(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i),
        bullets: manyMatches(html, /<li[^>]*>([\s\S]*?)<\/li>/gi, 8),
        paras: manyMatches(html, /<p[^>]*>([\s\S]*?)<\/p>/gi, 6),
        fallback: stripTags(html).slice(0, 1200),
      }];

  const lines = [`# FILE: ${fileName}`, "STEP3_RECOMPOSE_SOURCE_OUTLINE"];
  blocks.forEach((b, idx) => {
    lines.push(`\n[SLIDE ${idx + 1}]`);
    if (b.typeHint) lines.push(`TypeHint: ${b.typeHint}`);
    if (b.title) lines.push(`Title: ${b.title}`);
    const points = (b.bullets.length ? b.bullets : b.paras).slice(0, 5);
    if (points.length) {
      lines.push("KeyPoints:");
      points.forEach((p) => lines.push(`- ${p.slice(0, 180)}`));
    } else if (b.fallback) {
      lines.push(`Summary: ${b.fallback}`);
    }
  });
  return lines.join("\n");
}

function preprocessStep3Files(files) {
  return (files || []).map((file) => {
    const ext = String(path.extname(file.originalname || "")).toLowerCase();
    if (ext !== ".html" && ext !== ".htm") return file;
    const outline = htmlToStep3Outline(file.buffer.toString("utf8"), file.originalname || "step3-input.html");
    return {
      ...file,
      originalname: `${(file.originalname || "step3-input").replace(/\.(html?|txt)$/i, "")}.txt`,
      mimetype: "text/plain",
      buffer: Buffer.from(outline, "utf8"),
      size: Buffer.byteLength(outline, "utf8"),
    };
  });
}

router.post("/l3/build-direct", upload.array("documents"), async (req, res) => {
  try {
    const startedAt = Date.now();
    const rawFiles = req.files || [];
    const isStep3Recompose = String(req.body.recomposeMode || "").toLowerCase() === "step3";
    const files = isStep3Recompose ? preprocessStep3Files(rawFiles) : rawFiles;
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
      const step3PromptPrefix = isStep3Recompose
        ? "Step3 recompose mode: rebuild visual system from scratch; do not copy source CSS/class names/layout verbatim. Improve wording quality with concise executive phrasing while preserving facts."
        : "";
      result = await renderDirect({
        analysis: analyzed.analysis,
        combinedText: analyzed.combinedText,
        sourceFiles: analyzed.sourceFiles,
        designPrompt: [step3PromptPrefix, typeof req.body.designPrompt === "string" ? req.body.designPrompt : ""]
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
    const typedHtml = isStep3Recompose ? enforceTypeVisualContract(typed.html) : typed.html;
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
      mode: "direct",
      status,
      creativeMode: variantMeta.creativeMode === true,
      styleMode: variantMeta.styleMode || "normal",
      toneMode: variantMeta.toneMode || "auto",
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
      html: typedHtml,
      whyFallback,
      llmAttempts: meta.llmAttempts,
      analysis: analyzed.analysis,
      recomposeMode: isStep3Recompose ? "step3" : "none",
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
