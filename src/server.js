"use strict";

const path = require("path");
const express = require("express");
const { getEnv } = require("./config/env");
const { router } = require("./api/routes/generate-llm");

const app = express();
const env = getEnv();

app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(env.PORT, () => {
  process.stdout.write(`Server listening on http://localhost:${env.PORT}\n`);
});
