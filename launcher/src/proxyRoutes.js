"use strict";

const express = require("express");

function createProxyRoutes() {
  const router = express.Router();

  // Placeholder for Phase 4 proxy wiring.
  router.get("/ping", (req, res) => {
    res.json({ ok: true, message: "proxy routes placeholder" });
  });

  return router;
}

module.exports = {
  createProxyRoutes,
};

