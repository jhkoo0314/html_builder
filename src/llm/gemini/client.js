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

function mapReasonCode(error) {
  const msg = String(error && error.message ? error.message : "");
  if (error && error.code === "LLM_TIMEOUT") return "LLM_TIMEOUT";
  if (/fetch failed/i.test(msg)) return "LLM_NETWORK_ERROR";
  if (/api key not valid|permission denied|unauthorized|forbidden|401|403/i.test(msg)) return "LLM_AUTH_ERROR";
  if (/quota|rate limit|resource_exhausted|429/i.test(msg)) return "LLM_QUOTA_ERROR";
  if (/400 bad request|invalid json payload|unknown name/i.test(msg)) return "LLM_REQUEST_ERROR";
  if (/model.*not found|404/i.test(msg)) return "LLM_MODEL_ERROR";
  return "LLM_ERROR";
}

async function runWithModelFallback({ apiKey, candidates, prompt, timeoutMs }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const attempts = [];

  for (const modelName of candidates) {
    const startedAt = Date.now();
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await withTimeout(
        model.generateContent(prompt),
        timeoutMs,
        "LLM_TIMEOUT"
      );
      const text = result.response.text() || "";
      attempts.push({ model: modelName, ok: true, ms: Date.now() - startedAt });
      return { ok: true, text, attempts, model: modelName };
    } catch (error) {
      const reasonCode = mapReasonCode(error);
      attempts.push({
        model: modelName,
        ok: false,
        ms: Date.now() - startedAt,
        reasonCode,
        message: error.message,
      });
    }
  }

  return { ok: false, text: "", attempts, reasonCode: attempts[attempts.length - 1]?.reasonCode || "LLM_ERROR" };
}

module.exports = { runWithModelFallback, withTimeout };
