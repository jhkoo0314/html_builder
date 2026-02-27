"use strict";

const express = require("express");

const router = express.Router();

router.post("/l3/build-direct", async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: "NOT_IMPLEMENTED",
    message: "Layer3 direct build is not implemented yet.",
  });
});

router.post("/l3/build-from-run", async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: "NOT_IMPLEMENTED",
    message: "Layer3 from-run build is not implemented yet.",
  });
});

module.exports = {
  router,
};

