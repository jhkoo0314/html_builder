"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const { getEnv } = require("./config/env");
const { router } = require("./api/routes/generate-llm");

const app = express();
const env = getEnv();
const startedAt = new Date().toISOString();

app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use(express.static(path.join(process.cwd(), "public")));

function evaluateReadiness() {
  const artifactsRoot = process.env.ARTIFACTS_ROOT || "";
  if (!artifactsRoot) {
    return {
      ready: false,
      reason: "ARTIFACTS_ROOT_MISSING",
      artifactsRoot,
    };
  }
  try {
    fs.mkdirSync(artifactsRoot, { recursive: true });
    fs.accessSync(artifactsRoot, fs.constants.W_OK);
    return {
      ready: true,
      reason: "OK",
      artifactsRoot,
    };
  } catch (error) {
    return {
      ready: false,
      reason: `ARTIFACTS_ROOT_NOT_WRITABLE:${error.code || error.message}`,
      artifactsRoot,
    };
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/healthz", (req, res) => {
  const readiness = evaluateReadiness();
  const statusCode = readiness.ready ? 200 : 503;
  res.status(statusCode).json({
    ok: readiness.ready,
    service: "layer2-stable",
    version: "0.1.0-stable.1",
    port: Number(env.PORT),
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
    startedAt,
    artifactsRoot: readiness.artifactsRoot,
    ready: readiness.ready,
    details: {
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      llmEnabled: true,
      mode: "stable",
      reason: readiness.reason,
    },
  });
});

app.listen(env.PORT, () => {
  process.stdout.write(`Server listening on http://localhost:${env.PORT}\n`);
});
