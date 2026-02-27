"use strict";

const { ensureInteractiveDeckHtml } = require("../postprocess/navigation");

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function chunkLines(text, size) {
  const lines = String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

function renderHouseFallback({ title, combinedText, sourceFiles }) {
  const groups = chunkLines(combinedText, 6).slice(0, 10);
  const slides = groups.length ? groups : [["내용을 추출하지 못했습니다."]];

  const sections = slides.map((g, idx) => `
<section class="slide${idx === 0 ? " active" : ""}">
  <header><h2>${idx === 0 ? esc(title || "Generated Deck") : `Section ${idx}`}</h2></header>
  <div class="cards">${g.map((line) => `<p>${esc(line)}</p>`).join("")}</div>
  <footer>${esc((sourceFiles || []).join(", "))}</footer>
</section>`).join("\n");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "Fallback Deck")}</title>
<style>
:root{--bg:#0b1020;--panel:#121a30;--ink:#ecf2ff;--muted:#93a4c8;--line:#2c3a64;--pri:#34d399}
body{margin:0;background:radial-gradient(circle at 20% 0%,#1a2854,#080c18 55%);color:var(--ink);font-family:Segoe UI,sans-serif}
.slide{display:none;min-height:100vh;padding:56px;position:relative}
.slide.active{display:block}
.cards p{background:var(--panel);border:1px solid var(--line);padding:12px;border-radius:10px}
.nav-ui{position:fixed;right:16px;bottom:16px;display:flex;gap:8px}
.nav-ui button{padding:10px 12px;border:0;border-radius:8px;cursor:pointer}
</style>
</head>
<body>
<main class="deck">
${sections}
</main>
<div class="nav-ui"><button id="prev">Prev</button><button id="next">Next</button><button id="print">Print</button></div>
</body>
</html>`;

  return ensureInteractiveDeckHtml(html).html;
}

module.exports = { renderHouseFallback };
