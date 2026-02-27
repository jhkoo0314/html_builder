"use strict";

function createHtmlPrompts({ combinedText, title, designPrompt, creativeMode, styleMode, purposeMode }) {
  const modeRaw = String(styleMode || "normal").toLowerCase();
  const mode = modeRaw === "extreme" ? "extreme" : (modeRaw === "creative" ? "creative" : "normal");
  const creativeHint = String(creativeMode) === "true" || mode !== "normal";
  const normalHint = mode === "normal";
  const extremeHint = mode === "extreme";
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
    "Use <section class=\"slide\"> for each slide and keep at least 2 slides.",
    "Use Tailwind CDN utility classes for styling.",
    normalHint
      ? "Normal mode: favor clean, balanced, presentation-safe design with mostly light backgrounds and restrained font weight."
      : "",
    extremeHint
      ? "Extreme mode: push visual experimentation aggressively with bold layouts and unusual compositions while preserving readability."
      : "",
    creativeHint
      ? "Allow creative layouts, expressive typography, and bold color direction while preserving readability."
      : "Prefer conservative layout decisions optimized for reliability.",
  ].join(" ");

  const user = [
    `Title: ${title || "Auto-generated deck"}`,
    `Purpose mode: ${purpose}`,
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
