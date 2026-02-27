"use strict";

const mammoth = require("mammoth");

async function extractTextFromDocx(file) {
  const result = await mammoth.extractRawText({ buffer: file.buffer });
  return result.value || "";
}

module.exports = { extractTextFromDocx };
