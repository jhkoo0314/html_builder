"use strict";

const express = require("express");

const router = express.Router();

router.post("/l1/analyze", async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: "NOT_IMPLEMENTED",
    message: "Layer1 analyze pipeline is not implemented yet.",
  });
});

router.post("/l1/runs/:runId/save-outline", async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: "NOT_IMPLEMENTED",
    runId: req.params.runId,
    message: "Layer1 outline save API is not implemented yet.",
  });
});

module.exports = {
  router,
};

