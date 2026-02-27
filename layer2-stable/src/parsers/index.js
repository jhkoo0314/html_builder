"use strict";

const path = require("path");
const { extractTextFromPdf } = require("./pdf");
const { extractTextFromDocx } = require("./docx");
const { extractTextFromPlain } = require("./text");
const { DEFAULTS } = require("../config/defaults");

function ext(name) {
  return path.extname(name || "").toLowerCase();
}

async function extractOne(file) {
  const e = ext(file.originalname);
  if (e === ".pdf") return extractTextFromPdf(file);
  if (e === ".docx") return extractTextFromDocx(file);
  if (e === ".txt" || e === ".md") return extractTextFromPlain(file);
  return extractTextFromPlain(file);
}

async function extractUploadedTexts(files) {
  const extracted = [];
  for (const file of files) {
    const text = (await extractOne(file)).trim();
    extracted.push({ name: file.originalname, text });
  }

  const combined = extracted
    .map((x) => `# FILE: ${x.name}\n${x.text}`)
    .join("\n\n")
    .slice(0, DEFAULTS.MAX_COMBINED_CHARS);

  return {
    extracted,
    combinedText: combined,
  };
}

module.exports = { extractUploadedTexts };
