"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = process.cwd();
const l2Dir = path.join(repoRoot, "layer2-stable");
const l3Dir = path.join(repoRoot, "layer3-advanced");
const docsDir = path.join(repoRoot, "docs");
const evidencePath = path.join(docsDir, "L3_FORK_BASELINE_EVIDENCE.json");
const reportPath = path.join(docsDir, "PHASE1_5_REPORT.md");

const TARGET_TAG = "v0.1.0-stable.1";
const TARGET_METHOD = "file-level copy (one-time)";

function nowIso() {
  return new Date().toISOString();
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return "";
  }
}

function walkFiles(dirPath, list = []) {
  if (!fs.existsSync(dirPath)) return list;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, list);
      continue;
    }
    list.push(fullPath);
  }
  return list;
}

function isTextLike(filePath) {
  return [
    ".js",
    ".cjs",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
  ].includes(path.extname(filePath).toLowerCase());
}

function scanCrossImports(baseDir, forbiddenTokens) {
  const violations = [];
  if (!fs.existsSync(baseDir)) return violations;

  const files = walkFiles(baseDir).filter(isTextLike);
  for (const filePath of files) {
    const rel = path.relative(repoRoot, filePath);
    const text = safeReadText(filePath);
    for (const token of forbiddenTokens) {
      if (text.includes(token)) {
        violations.push(`${rel} -> token "${token}"`);
      }
    }
  }
  return violations;
}

function checkEvidence() {
  if (!fs.existsSync(evidencePath)) {
    return {
      ok: false,
      detail: `missing evidence file: ${path.relative(repoRoot, evidencePath)}`,
    };
  }

  let json = null;
  try {
    json = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      detail: `invalid json: ${error.message}`,
    };
  }

  const tagOk = json.sourceTag === TARGET_TAG;
  const methodOk = json.cloneMethod === TARGET_METHOD;
  const hasTimestamp = typeof json.cloneTimestamp === "string" && json.cloneTimestamp.length > 0;
  const hasAuthor = typeof json.recordedBy === "string" && json.recordedBy.length > 0;

  if (tagOk && methodOk && hasTimestamp && hasAuthor) {
    return { ok: true, detail: "evidence fields are valid" };
  }

  return {
    ok: false,
    detail: `evidence mismatch (sourceTag=${String(json.sourceTag)}, cloneMethod=${String(json.cloneMethod)}, cloneTimestamp=${String(json.cloneTimestamp)}, recordedBy=${String(json.recordedBy)})`,
  };
}

function checkPackageIndependence() {
  const failures = [];

  const rootPkgPath = path.join(repoRoot, "package.json");
  try {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
    if (rootPkg.workspaces) {
      failures.push("root package.json must not define workspaces");
    }
  } catch (error) {
    failures.push(`root package.json read error: ${error.message}`);
  }

  for (const dirPath of [l2Dir, l3Dir]) {
    const label = path.basename(dirPath);
    if (!fs.existsSync(dirPath)) {
      failures.push(`${label} directory missing`);
      continue;
    }
    const pkgPath = path.join(dirPath, "package.json");
    const lockPath = path.join(dirPath, "package-lock.json");
    if (!fs.existsSync(pkgPath)) failures.push(`${label}: missing package.json`);
    if (!fs.existsSync(lockPath)) failures.push(`${label}: missing package-lock.json`);

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const scripts = pkg.scripts || {};
        for (const [name, command] of Object.entries(scripts)) {
          const commandText = String(command);
          if (
            commandText.includes("layer2-stable") ||
            commandText.includes("layer3-advanced") ||
            commandText.includes("../")
          ) {
            failures.push(`${label}: script "${name}" contains cross-layer reference`);
          }
        }
      } catch (error) {
        failures.push(`${label}: package.json parse error: ${error.message}`);
      }
    }
  }

  return failures;
}

function toCheck(id, ok, detail) {
  return { id, ok, detail };
}

function writeReport(checks) {
  const lines = [];
  lines.push("# Phase 1.5 Verification Report");
  lines.push("");
  lines.push(`- GeneratedAt: ${nowIso()}`);
  lines.push(`- Tool: scripts/verify-l3-fork-baseline.js`);
  lines.push("");
  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    lines.push(`## ${check.id}: ${mark}`);
    lines.push(`- ${check.detail}`);
    lines.push("");
  }

  const summaryOk = checks.every((item) => item.ok);
  lines.push(`## Summary: ${summaryOk ? "PASS" : "FAIL"}`);
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const checks = [];

  const evidence = checkEvidence();
  checks.push(toCheck("P1.5-1 one-time copy evidence", evidence.ok, evidence.detail));

  const l2ToL3Violations = scanCrossImports(l2Dir, [
    "layer3-advanced",
    "../layer3-advanced",
    "..\\layer3-advanced",
  ]);
  const l3ToL2Violations = scanCrossImports(l3Dir, [
    "layer2-stable",
    "../layer2-stable",
    "..\\layer2-stable",
  ]);
  const crossViolations = [...l2ToL3Violations, ...l3ToL2Violations];
  checks.push(
    toCheck(
      "P1.5-2 cross import scan",
      crossViolations.length === 0,
      crossViolations.length === 0 ? "no cross-layer token found" : crossViolations.join("; ")
    )
  );

  const packageFailures = checkPackageIndependence();
  checks.push(
    toCheck(
      "P1.5-3 package/script independence",
      packageFailures.length === 0,
      packageFailures.length === 0 ? "independent package/script checks passed" : packageFailures.join("; ")
    )
  );

  writeReport(checks);

  const allPass = checks.every((item) => item.ok);
  process.stdout.write(`${allPass ? "PASS" : "FAIL"} - report: ${path.relative(repoRoot, reportPath)}\n`);
  if (!allPass) process.exitCode = 1;
}

main();

