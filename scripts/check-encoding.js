#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

// ---- Config (필요시 여기만 조정) ----
const IGNORE_DIR_PARTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "out",
]);

const TEXT_EXTS = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".tsx",
  ".json", ".md", ".txt",
  ".html", ".htm", ".css",
  ".yml", ".yaml",
  ".env", ".env.example",
  ".sh", ".bash", ".zsh",
  ".ps1",
  ".gitignore", ".gitattributes", ".editorconfig",
]);

const BINARY_EXTS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".zip", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf",
  ".mp3", ".mp4", ".mov",
]);

// Optional allowlist file (repo root)
const ALLOWLIST_PATH = path.join(ROOT, "encoding.allowlist.json");
// Example allowlist schema:
// { "allowReplacementChar": ["docs/legacy.md"], "ignore": ["vendor/"] }
function loadAllowlist() {
  try {
    if (!fs.existsSync(ALLOWLIST_PATH)) return { allowReplacementChar: [], ignore: [] };
    const raw = fs.readFileSync(ALLOWLIST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      allowReplacementChar: Array.isArray(parsed.allowReplacementChar) ? parsed.allowReplacementChar : [],
      ignore: Array.isArray(parsed.ignore) ? parsed.ignore : [],
    };
  } catch {
    return { allowReplacementChar: [], ignore: [] };
  }
}

const allowlist = loadAllowlist();

function normRel(p) {
  const rel = path.relative(ROOT, p);
  return rel.split(path.sep).join("/");
}

function isIgnoredByDir(rel) {
  const parts = rel.split("/");
  return parts.some((x) => IGNORE_DIR_PARTS.has(x));
}

function isIgnoredByAllowlist(rel) {
  // 매우 단순한 prefix ignore (glob 없이 운영 안정성 우선)
  return allowlist.ignore.some((prefix) => rel.startsWith(prefix));
}

function extOf(rel) {
  // ".env" 같은 케이스는 extname이 ".env"로 잘 나옴
  return path.extname(rel).toLowerCase();
}

function isBinaryExt(rel) {
  return BINARY_EXTS.has(extOf(rel));
}

function isTextExt(rel) {
  const e = extOf(rel);
  if (e) return TEXT_EXTS.has(e);
  // 확장자가 없는 파일(.gitignore 등)은 basename 기준으로 처리
  const base = path.basename(rel).toLowerCase();
  return TEXT_EXTS.has("." + base) || TEXT_EXTS.has(base);
}

function listAllFiles(dirAbs) {
  const out = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dirAbs, ent.name);
    const rel = normRel(abs);
    if (ent.isDirectory()) {
      if (isIgnoredByDir(rel) || isIgnoredByAllowlist(rel)) continue;
      out.push(...listAllFiles(abs));
    } else if (ent.isFile()) {
      if (isIgnoredByDir(rel) || isIgnoredByAllowlist(rel)) continue;
      out.push(abs);
    }
  }
  return out;
}

function getStagedFiles() {
  // Added/Changed/Copied/Modified/Renamed only
  const cmd = "git diff --cached --name-only --diff-filter=ACMR";
  const out = cp.execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
    .toString("utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Convert to abs path
  return out.map((rel) => path.join(ROOT, rel));
}

function startsWithBytes(buf, bytes) {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

const BOM_UTF8 = [0xEF, 0xBB, 0xBF];
const BOM_UTF16LE = [0xFF, 0xFE];
const BOM_UTF16BE = [0xFE, 0xFF];
const BOM_UTF32BE = [0x00, 0x00, 0xFE, 0xFF];
const BOM_UTF32LE = [0xFF, 0xFE, 0x00, 0x00];

function countByte(buf, byte) {
  let c = 0;
  for (const b of buf) if (b === byte) c++;
  return c;
}

function hasSuspiciousBinaryHeuristic(buf) {
  // 텍스트 확장자가 없는 파일을 위한 휴리스틱 (과도한 오탐 방지 위해 보수적으로)
  // - NUL 바이트가 있으면 거의 확실히 바이너리/UTF-16
  const nul = countByte(buf, 0x00);
  if (nul > 0) return true;

  // - 제어문자 비율이 지나치게 높으면 바이너리로 간주
  let ctrl = 0;
  for (const b of buf) {
    // 탭(9), 개행(10), 캐리지리턴(13)은 허용
    if (b < 0x20 && b !== 0x09 && b !== 0x0A && b !== 0x0D) ctrl++;
  }
  const ratio = ctrl / Math.max(1, buf.length);
  return ratio > 0.25;
}

function checkFile(absPath) {
  const rel = normRel(absPath);

  if (isIgnoredByDir(rel) || isIgnoredByAllowlist(rel)) return null;
  if (isBinaryExt(rel)) return null;

  // 텍스트 확장자만 강제 검사. (확장자 없는 파일은 휴리스틱으로 텍스트/바이너리 추정)
  const knownText = isTextExt(rel);
  const buf = fs.readFileSync(absPath); // Buffer

  if (!knownText) {
    // 확장자 애매하면, 바이너리 휴리스틱이면 스킵(바이너리 취급), 아니면 텍스트로 검사
    const head = buf.subarray(0, Math.min(buf.length, 8192));
    if (hasSuspiciousBinaryHeuristic(head)) return null;
  }

  const issues = [];

  // BOM 금지
  if (startsWithBytes(buf, BOM_UTF8)) issues.push("BOM_UTF8_FORBIDDEN");
  if (startsWithBytes(buf, BOM_UTF16LE) || startsWithBytes(buf, BOM_UTF16BE)) issues.push("BOM_UTF16_FORBIDDEN");
  if (startsWithBytes(buf, BOM_UTF32BE) || startsWithBytes(buf, BOM_UTF32LE)) issues.push("BOM_UTF32_FORBIDDEN");

  // NUL 바이트(UTF-16/바이너리 흔적) 금지 — 텍스트 파일로 간주되는 경우만
  // (알려진 텍스트 확장자거나 휴리스틱상 텍스트로 본 경우)
  const nulCount = countByte(buf, 0x00);
  if (nulCount > 0) issues.push(`NUL_BYTES_FOUND(${nulCount})`);

  // UTF-8 디코딩 시 U+FFFD 포함 검사
  const text = buf.toString("utf8");
  if (text.includes("\uFFFD")) {
    const allowed = allowlist.allowReplacementChar.includes(rel);
    if (!allowed) issues.push("REPLACEMENT_CHAR_U+FFFD_FOUND(�)");
  }

  // 권장: HTML/MD/프롬프트에서 흔한 깨짐 패턴(선택적 경고)
  // - “??/button>” 같은 이상 토큰은 encoding이라기보다 오염인데, 여기서는 경고로만 출력
  const warn = [];
  if (/\?\?\/button>/i.test(text)) warn.push("WARN_SUSPECT_TOKEN(??/button>)");

  if (!issues.length && !warn.length) return null;

  return { rel, issues, warn };
}

function printResult(results) {
  const bad = results.filter((r) => r && r.issues && r.issues.length > 0);
  const warns = results.filter((r) => r && r.warn && r.warn.length > 0);

  if (bad.length === 0 && warns.length === 0) {
    console.log("✅ Encoding check passed (UTF-8 without BOM).");
    return { ok: true };
  }

  if (bad.length > 0) {
    console.error("❌ Encoding check FAILED. Fix issues below:");
    for (const r of bad) {
      console.error(`- ${r.rel}`);
      for (const issue of r.issues) console.error(`  - ${issue}`);
      if (r.warn && r.warn.length) {
        for (const w of r.warn) console.error(`  - ${w}`);
      }
    }
  }

  if (warns.length > 0 && bad.length === 0) {
    console.warn("⚠️ Encoding check warnings:");
    for (const r of warns) {
      console.warn(`- ${r.rel}`);
      for (const w of r.warn) console.warn(`  - ${w}`);
    }
  }

  // Allowlist hint
  const hasFFFD = bad.some((r) => r.issues.some((x) => x.includes("U+FFFD")));
  if (hasFFFD) {
    console.error("\nTip: If a file legitimately contains '�', add it to encoding.allowlist.json -> allowReplacementChar.");
  }

  return { ok: bad.length === 0 };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const useStaged = args.has("--staged");
  const useAll = args.has("--all");

  let files = [];
  if (useStaged) {
    try {
      files = getStagedFiles();
    } catch (e) {
      console.error("❌ Failed to read staged files. Are you in a git repo?");
      console.error(String(e?.message || e));
      process.exit(2);
    }
  } else if (useAll) {
    files = listAllFiles(ROOT);
  } else {
    // default: all files (CI용) 대신 사용자가 실수로 느리게 돌릴 수 있으니 staged를 권장
    // 하지만 요구가 애매하면 안전하게 all 수행
    files = listAllFiles(ROOT);
  }

  // 존재하는 파일만
  files = files.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());

  const results = [];
  for (const f of files) {
    const res = checkFile(f);
    if (res) results.push(res);
  }

  const { ok } = printResult(results);
  process.exit(ok ? 0 : 1);
}

main();