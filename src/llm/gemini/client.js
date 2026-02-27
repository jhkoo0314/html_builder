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
  const status = Number(error && (error.status || error.statusCode));
  if (error && error.code === "LLM_TIMEOUT") return "LLM_TIMEOUT";
  if (status === 503 || /503|service unavailable|high demand/i.test(msg)) return "LLM_OVERLOADED";
  if (/aborted|aborterror|timed out|timeout/i.test(msg)) return "LLM_TIMEOUT";
  if (/fetch failed/i.test(msg)) return "LLM_NETWORK_ERROR";
  if (/api key not valid|permission denied|unauthorized|forbidden|401|403/i.test(msg)) return "LLM_AUTH_ERROR";
  if (/quota|rate limit|resource_exhausted|429/i.test(msg)) return "LLM_QUOTA_ERROR";
  if (/400 bad request|invalid json payload|unknown name/i.test(msg)) return "LLM_REQUEST_ERROR";
  if (/model.*not found|404/i.test(msg)) return "LLM_MODEL_ERROR";
  return "LLM_ERROR";
}

function isOverloaded503(error) {
  const msg = String(error && error.message ? error.message : "");
  const status = Number(error && (error.status || error.statusCode));
  return status === 503 || /503|service unavailable|high demand/i.test(msg);
}

function getPerModelTimeoutMs(modelName, fallbackTimeoutMs, remainingBudgetMs) {
  const defaultTimeout = Number.isFinite(fallbackTimeoutMs) && fallbackTimeoutMs > 0
    ? fallbackTimeoutMs
    : 35000;
  let capMs = defaultTimeout;
  if (modelName === "gemini-2.5-flash") capMs = 60000;
  if (modelName === "gemini-3-flash-preview") capMs = 15000;
  return Math.max(1, Math.min(capMs, remainingBudgetMs));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    let retried503 = false;
    while (true) {
      const loopElapsed = Date.now() - startedAt;
      const loopRemainingBudgetMs = useBudget ? (totalBudgetMs - loopElapsed) : perAttemptMs;
      if (useBudget && loopRemainingBudgetMs < minRemainingMs) {
        budgetExhausted = true;
        break;
      }
      const computedTimeoutMs = useBudget
        ? getPerModelTimeoutMs(modelName, perAttemptMs, loopRemainingBudgetMs)
        : getPerModelTimeoutMs(modelName, perAttemptMs, perAttemptMs);
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
        const overloaded = isOverloaded503(error);
        const reasonCode = mapReasonCode(error);
        attempts.push({
          model: modelName,
          ok: false,
          ms: Date.now() - attemptStartedAt,
          timeoutMs: computedTimeoutMs,
          reasonCode,
          message: error.message,
        });
        if (overloaded && !retried503) {
          retried503 = true;
          const backoffMs = 800 + Math.floor(Math.random() * 701);
          const afterErrorElapsed = Date.now() - startedAt;
          const afterErrorRemaining = useBudget ? (totalBudgetMs - afterErrorElapsed) : backoffMs;
          if (!useBudget || afterErrorRemaining > Math.max(backoffMs, minRemainingMs)) {
            await sleep(backoffMs);
            continue;
          }
        }
        break;
      }
    }
    if (budgetExhausted) break;
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
