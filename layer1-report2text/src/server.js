"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const { router } = require("./api/routes");

const app = express();
const startedAt = new Date().toISOString();
const port = Number(process.env.PORT || 5171);

app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use(express.static(path.join(__dirname, "..", "public")));

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

app.get("/healthz", (req, res) => {
  const readiness = evaluateReadiness();
  const statusCode = readiness.ready ? 200 : 503;
  return res.status(statusCode).json({
    ok: readiness.ready,
    service: "layer1-report2text",
    version: "0.2.0",
    port,
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
    startedAt,
    artifactsRoot: readiness.artifactsRoot,
    ready: readiness.ready,
    details: {
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      llmEnabled: Boolean(process.env.GEMINI_API_KEY),
      mode: "analyze",
      reason: readiness.reason,
    },
  });
});

app.listen(port, () => {
  process.stdout.write(`Layer1 listening on http://localhost:${port}\n`);
});
