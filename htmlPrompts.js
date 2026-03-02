"use strict";

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

function createHtmlPrompts({ combinedText, title, designPrompt, creativeMode, styleMode, toneMode, purposeMode }) {
  const modeRaw = String(styleMode || "normal").toLowerCase();
  const mode = modeRaw === "extreme" ? "extreme" : (modeRaw === "creative" ? "creative" : "normal");
  const toneRaw = String(toneMode || "auto").toLowerCase();
  const tone = toneRaw === "light" ? "light" : (toneRaw === "dark" ? "dark" : "auto");
  const creativeHint = String(creativeMode) === "true" || mode !== "normal";
  const normalHint = mode === "normal";
  const extremeHint = mode === "extreme";
  const lightHint = tone === "light";
  const darkHint = tone === "dark";
  const purpose = "general";
  const system = [
    "You are a presentation HTML generator.",
    "Return HTML only. No markdown.",
    creativeHint
      ? "Prioritize distinctive visual design with strong hierarchy, contrast, and intentional composition."
      : "Use house style: Next-gen executive + modern editorial hybrid.",
    "Build a complete document with doctype/html/head/body.",
    "Include meta charset utf-8.",
    "Cover the major topics from the source without omissions.",
    "Split dense topics into separate slides when clarity improves.",
    "Keep each slide compact and focused on one main idea.",
    "Avoid repeating the same points across slides.",
    "Ensure first slide is visible and navigation works.",
    "Include Prev/Next buttons and keyboard support.",
    "Include print CSS with page-break per slide.",
    "Use <section class=\"slide\"> for each slide.",
    "Use Tailwind CDN utility classes for styling.",
    `Allowed slide types only: ${SLIDE_TYPES.join(", ")}.`,
    "Set data-slide-type on every section.slide using only one value from the allowed set.",
    "Do not invent slide-type values outside the allowed set.",
    "Do not force slide count; preserve or adapt count based on content clarity.",
    "Keep visual/layout freedom high inside each slide type.",
    "If source includes prior HTML/CSS, treat it as content reference only and avoid copying its style blocks, class names, or layout literally.",
    "Prefer a fresh visual direction with stronger hierarchy, contrast, and spacing rhythm.",
    "If numeric evidence is missing, avoid fake charts; use cards, lists, or structured text blocks instead.",
    "Preserve user text intent and factual content; prioritize faithful layout recomposition over rewriting.",
    normalHint
      ? "Normal mode: favor clean, balanced, presentation-safe design with mostly light backgrounds and restrained font weight."
      : "",
    extremeHint
      ? "Extreme mode: push visual experimentation aggressively with bold layouts and unusual compositions while preserving readability."
      : "",
    creativeHint
      ? "Allow creative layouts, expressive typography, and bold color direction while preserving readability."
      : "Prefer conservative layout decisions optimized for reliability.",
    lightHint
      ? "Tone mode light: use mostly bright/light backgrounds, avoid dominant dark canvas, keep strong text contrast on light surfaces."
      : "",
    darkHint
      ? "Tone mode dark: prefer dark backgrounds with readable light text, keep contrast high and avoid washed-out grays."
      : "",
    tone === "auto"
      ? "Tone mode auto: choose light or dark based on content fit, but keep readability first."
      : "",
  ].join(" ");

  const user = [
    `Title: ${title || "Auto-generated deck"}`,
    `Purpose mode: ${purpose}`,
    `Tone mode: ${tone}`,
    designPrompt ? `Design intent: ${designPrompt}` : "",
    "Source text:",
    combinedText,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}

function createRepairPrompt(rawHtml) {
  return [
    "Fix HTML validity, remove broken tags, ensure navigation works.",
    "If slides are fewer than 2 or <section class=\"slide\"> is missing, restructure into 2+ section.slide blocks.",
    "Do not change slide content unless required to fix breakage.",
    "Preserve slide count unless slides are empty or structurally broken.",
    "Return complete HTML only.",
    "Input:",
    rawHtml,
  ].join("\n\n");
}

module.exports = { createHtmlPrompts, createRepairPrompt };
