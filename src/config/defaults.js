"use strict";

const DEFAULTS = {
  HOUSE_STYLE_ID: "house-nextgen-exec",
  WORKFLOW: "direct-html",
  VARIANT: 1,
  REFERENCE_MODE: "off",
  PAGE_MODE: "default",
  REQUEST_TIMEOUT_MS: 150000,
  LLM_GENERATE_TIMEOUT_MS: 60000,
  LLM_REPAIR_TIMEOUT_MS: 40000,
  MODEL_CANDIDATES: ["gemini-3-flash-preview", "gemini-2.5-flash"],
  MAX_COMBINED_CHARS: 20000,
  MIN_SLIDES_REQUIRED: 2,
  RECOMMENDED_SLIDES: 6,
};

module.exports = { DEFAULTS };
