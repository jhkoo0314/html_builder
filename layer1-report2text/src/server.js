"use strict";

const path = require("path");
const express = require("express");
const { router } = require("./api/routes");

const app = express();
const startedAt = new Date().toISOString();
const port = Number(process.env.PORT || 5171);

app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/healthz", (req, res) => {
  return res.json({
    ok: true,
    service: "layer1-report2text",
    version: "0.2.0",
    port,
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
    startedAt,
    artifactsRoot: process.env.ARTIFACTS_ROOT || "",
    ready: true,
    details: {
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      llmEnabled: Boolean(process.env.GEMINI_API_KEY),
      mode: "analyze",
    },
  });
});

app.listen(port, () => {
  process.stdout.write(`Layer1 listening on http://localhost:${port}\n`);
});

