"use strict";

const express = require("express");
const multer = require("multer");
const {
  analyze,
  generateQuestions,
  approveAndAutoRun,
  getStatus,
  getLogs,
  subscribe,
} = require("../../l3/promptFlowService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function sendError(res, error) {
  const code = String(error && error.code ? error.code : "PROMPT_FLOW_FAILED");
  const status = code === "PROMPT_FLOW_NOT_FOUND" ? 404 : 400;
  return res.status(status).json({
    ok: false,
    error: code,
    message: error && error.message ? error.message : "Prompt flow request failed.",
  });
}

router.post("/l3/prompt-flow/analyze", upload.array("documents"), async (req, res) => {
  try {
    const result = await analyze({
      files: req.files || [],
      pastedText: typeof req.body.pastedText === "string" ? req.body.pastedText : "",
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/l3/prompt-flow/questions", async (req, res) => {
  try {
    const result = await generateQuestions({ runId: req.body && req.body.runId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/l3/prompt-flow/approve", async (req, res) => {
  try {
    const result = await approveAndAutoRun({
      runId: req.body && req.body.runId,
      answers: req.body && req.body.answers,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/l3/prompt-flow/:runId/status", (req, res) => {
  try {
    const result = getStatus({ runId: req.params.runId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/l3/prompt-flow/:runId/logs", (req, res) => {
  try {
    const result = getLogs({ runId: req.params.runId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/l3/prompt-flow/:runId/stream", (req, res) => {
  try {
    const runId = req.params.runId;
    const snapshot = getLogs({ runId });
    const status = getStatus({ runId });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    for (const entry of snapshot.logs || []) {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    }

    const unsubscribe = subscribe({
      runId,
      onLog: (entry) => {
        res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      },
      onStatus: (entry) => {
        res.write(`event: status\ndata: ${JSON.stringify({ ok: true, ...entry })}\n\n`);
      },
    });

    const keepAlive = setInterval(() => {
      res.write("event: ping\ndata: {}\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = { router };
