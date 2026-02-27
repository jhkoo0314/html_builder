"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

function loadDotenv() {
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", ".env"),
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath });
    if (process.env.GEMINI_API_KEY) break;
  }
}

loadDotenv();

function getEnv() {
  return {
    PORT: Number(process.env.PORT || 3000),
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  };
}

module.exports = { getEnv };
