"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { L3BuildError } = require("./errors");

function resolveArtifactsRoot(root) {
  if (root && String(root).trim()) return String(root).trim();
  return path.resolve(process.cwd(), "..", ".artifacts");
}

function ensureArtifactsRoot(root) {
  const resolved = resolveArtifactsRoot(root);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
    return resolved;
  } catch (error) {
    throw new L3BuildError(
      "ARTIFACTS_ROOT_NOT_WRITABLE",
      `Artifacts root is not writable: ${resolved} (${error.code || error.message})`,
      500
    );
  }
}

function createRunId() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const tail = crypto.randomBytes(3).toString("hex");
  return `${y}${m}${d}_${hh}${mm}${ss}_${tail}`;
}

function writeLayer3Artifacts({ artifactsRoot, runId, analysis, html, meta }) {
  const baseDir = path.join(artifactsRoot, runId, "layer3");
  fs.mkdirSync(baseDir, { recursive: true });

  const analysisPath = path.join(baseDir, "analysis.json");
  const deckPath = path.join(baseDir, "deck.html");
  const metaPath = path.join(baseDir, "meta.json");

  if (analysis && typeof analysis === "object") {
    fs.writeFileSync(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(deckPath, html, "utf8");
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  return { analysisPath: fs.existsSync(analysisPath) ? analysisPath : null, deckPath, metaPath };
}

function toPublicPath(filePath, artifactsRoot) {
  const rel = path.relative(artifactsRoot, filePath).replace(/\\/g, "/");
  return `/artifacts/${rel}`;
}

module.exports = {
  resolveArtifactsRoot,
  ensureArtifactsRoot,
  createRunId,
  writeLayer3Artifacts,
  toPublicPath,
};
