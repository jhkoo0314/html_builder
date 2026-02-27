"use strict";

const path = require("path");
const express = require("express");
const { getEnv } = require("./config/env");
const { router } = require("./api/routes/generate-llm");
const { router: l3Router } = require("./api/routes/l3");

const app = express();
const env = getEnv();
const startedAt = new Date().toISOString();

app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use("/api", l3Router);
app.use(express.static(path.join(process.cwd(), "public")));

function evaluateReadiness() {
  return {
    ready: true,
    reason: "OK",
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/healthz", (req, res) => {
  const readiness = evaluateReadiness();
  const statusCode = readiness.ready ? 200 : 503;
  res.status(statusCode).json({
    ok: readiness.ready,
    service: "layer3-advanced",
    version: "0.2.0",
    port: Number(env.PORT),
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
    startedAt,
    ready: readiness.ready,
    details: {
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      llmEnabled: true,
      mode: "direct",
      reason: readiness.reason,
    },
  });
});

app.listen(env.PORT, () => {
  process.stdout.write(`Server listening on http://localhost:${env.PORT}\n`);
});
