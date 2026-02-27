"use strict";

const express = require("express");
const multer = require("multer");
const { generatePipeline } = require("../../pipelines/generatePipeline");
const { runNetworkDiagnostics } = require("../../diagnostics/network");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/generate-llm", upload.array("documents"), async (req, res) => {
  try {
    const files = req.files || [];
    const result = await generatePipeline({ files });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: "GENERATE_FAILED",
      message: error.message,
    });
  }
});

router.get("/network-diagnostics", async (req, res) => {
  try {
    const diagnostics = await runNetworkDiagnostics();
    res.json({ ok: true, diagnostics });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "NETWORK_DIAGNOSTICS_FAILED",
      message: error.message,
    });
  }
});

module.exports = { router };
