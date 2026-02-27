"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function generateContentWithAbort(model, prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await model.generateContent(prompt, { timeout: timeoutMs, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapReasonCode(error) {
  const msg = String(error && error.message ? error.message : "");
  if (error && error.code === "LLM_TIMEOUT") return "LLM_TIMEOUT";
  if (/aborted|aborterror|timed out|timeout/i.test(msg)) return "LLM_TIMEOUT";
  if (/fetch failed/i.test(msg)) return "LLM_NETWORK_ERROR";
  if (/api key not valid|permission denied|unauthorized|forbidden|401|403/i.test(msg)) return "LLM_AUTH_ERROR";
  if (/quota|rate limit|resource_exhausted|429/i.test(msg)) return "LLM_QUOTA_ERROR";
  if (/400 bad request|invalid json payload|unknown name/i.test(msg)) return "LLM_REQUEST_ERROR";
  if (/model.*not found|404/i.test(msg)) return "LLM_MODEL_ERROR";
  return "LLM_ERROR";
}

async function runWithModelFallback({
  apiKey,
  candidates,
  prompt,
  timeoutMs,
  totalBudgetMs,
  attemptTimeoutMs,
  minRemainingMs = 5000,
}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const attempts = [];
  const startedAt = Date.now();
  const useBudget = Number.isFinite(totalBudgetMs) && totalBudgetMs > 0;
  const perAttemptMs = Number.isFinite(attemptTimeoutMs) && attemptTimeoutMs > 0
    ? attemptTimeoutMs
    : timeoutMs;
  let budgetExhausted = false;

  for (const modelName of candidates) {
    const elapsed = Date.now() - startedAt;
    const remainingBudgetMs = useBudget ? (totalBudgetMs - elapsed) : perAttemptMs;
    if (useBudget && remainingBudgetMs < minRemainingMs) {
      budgetExhausted = true;
      break;
    }
    const computedTimeoutMs = useBudget
      ? Math.max(1, Math.min(perAttemptMs, remainingBudgetMs))
      : perAttemptMs;

    const attemptStartedAt = Date.now();
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await generateContentWithAbort(model, prompt, computedTimeoutMs);
      const text = result.response.text() || "";
      attempts.push({
        model: modelName,
        ok: true,
        ms: Date.now() - attemptStartedAt,
        timeoutMs: computedTimeoutMs,
      });
      return {
        ok: true,
        text,
        attempts,
        model: modelName,
        budgetMs: useBudget ? totalBudgetMs : null,
        attemptTimeoutMs: perAttemptMs,
      };
    } catch (error) {
      const reasonCode = mapReasonCode(error);
      attempts.push({
        model: modelName,
        ok: false,
        ms: Date.now() - attemptStartedAt,
        timeoutMs: computedTimeoutMs,
        reasonCode,
        message: error.message,
      });
    }
  }

  const reasonCode = budgetExhausted
    ? "LLM_TIMEOUT"
    : (attempts[attempts.length - 1]?.reasonCode || "LLM_ERROR");
  return {
    ok: false,
    text: "",
    attempts,
    reasonCode,
    budgetMs: useBudget ? totalBudgetMs : null,
    attemptTimeoutMs: perAttemptMs,
  };
}

module.exports = { runWithModelFallback, withTimeout };
