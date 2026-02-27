"use strict";

function createHtmlPrompts({ combinedText, title }) {
  const system = [
    "You are a presentation HTML generator.",
    "Return HTML only. No markdown.",
    "Use house style: Next-gen executive + modern editorial hybrid.",
    "Build a complete document with doctype/html/head/body.",
    "Include meta charset utf-8.",
    "Cover the major topics from the source without omissions.",
    "Split dense topics into separate slides when clarity improves.",
    "Keep each slide compact and focused on one main idea.",
    "Avoid repeating the same points across slides.",
    "Ensure first slide is visible and navigation works.",
    "Include Prev/Next buttons and keyboard support.",
    "Include print CSS with page-break per slide.",
  ].join(" ");

  const user = [
    `Title: ${title || "Auto-generated deck"}`,
    "Source text:",
    combinedText,
  ].join("\n\n");

  return { system, user };
}

function createRepairPrompt(rawHtml) {
  return [
    "Fix HTML validity, remove broken tags, ensure navigation works.",
    "Do not change slide content unless required to fix breakage.",
    "Preserve slide count unless slides are empty or structurally broken.",
    "Return complete HTML only.",
    "Input:",
    rawHtml,
  ].join("\n\n");
}

module.exports = { createHtmlPrompts, createRepairPrompt };
