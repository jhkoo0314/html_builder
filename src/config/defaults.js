"use strict";

const DEFAULTS = {
  HOUSE_STYLE_ID: "house-nextgen-exec",
  WORKFLOW: "direct-html",
  VARIANT: 1,
  REFERENCE_MODE: "off",
  PAGE_MODE: "default",
  REQUEST_TIMEOUT_MS: 150000,
  LLM_GENERATE_TIMEOUT_MS: 120000,
  LLM_REPAIR_TIMEOUT_MS: 40000,
  TOTAL_LLM_BUDGET_MS: 135000,
  ATTEMPT_TIMEOUT_MS: 120000,
  MIN_LLM_REMAINING_BUDGET_MS: 5000,
  MODEL_CANDIDATES: ["gemini-2.5-flash", "gemini-3-flash-preview"],
  MODEL_TIMEOUTS_MS: {
    "gemini-2.5-flash": 120000,
    "gemini-3-flash-preview": 15000,
  },
  MAX_COMBINED_CHARS: 20000,
  MIN_SLIDES_REQUIRED: 2,
  RECOMMENDED_SLIDES: 6,
};

module.exports = { DEFAULTS };
