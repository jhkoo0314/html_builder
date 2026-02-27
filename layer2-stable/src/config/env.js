"use strict";

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env") });

function getEnv() {
  return {
    PORT: Number(process.env.PORT || 3000),
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  };
}

module.exports = { getEnv };
