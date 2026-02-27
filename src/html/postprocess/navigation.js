"use strict";

const { hasNavLogic } = require("./meaningful");

const NAV_ENGINE = `
<script id="deck-nav-engine">
(function(){
  const slides = Array.from(document.querySelectorAll('section'));
  if (!slides.length) return;
  let idx = 0;

  function show(i){
    idx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, n) => s.classList.toggle('active', n === idx));
    const bar = document.querySelector('.progress-bar,[data-progress],#progress');
    if (bar && bar.style) {
      bar.style.width = ((idx + 1) / slides.length * 100) + '%';
    }
  }

  function findBtn(selA, selB, fallbackIndex){
    return document.querySelector(selA) || document.querySelector(selB) ||
      (document.querySelectorAll('.nav-ui button')[fallbackIndex] || null);
  }

  const prev = findBtn('#prev', '#prevBtn', 0);
  const next = findBtn('#next', '#nextBtn', 1);
  const printBtn = document.querySelector('#print,#printBtn');

  if (prev) prev.addEventListener('click', () => show(idx - 1));
  if (next) next.addEventListener('click', () => show(idx + 1));
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') show(idx + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(idx - 1);
    if (e.key === 'Home') show(0);
    if (e.key === 'End') show(slides.length - 1);
  });

  show(0);
})();
</script>`;

const PRINT_PATCH = `
<style id="deck-print-patch">
@media print {
  section { display: block !important; page-break-after: always; break-after: page; }
  .nav-ui, #controls { display: none !important; }
}
</style>`;

function ensureFirstSlideActive(html) {
  return html.replace(/<section\b([^>]*)>/i, (m, attrs) => {
    if (/class\s*=/.test(attrs)) {
      if (/active/.test(attrs)) return m;
      return `<section${attrs.replace(/class\s*=\s*(["'])(.*?)\1/i, (cm, q, cls) => `class=${q}${cls} active${q}`)}>`;
    }
    return `<section${attrs} class="active">`;
  });
}

function injectBeforeBodyClose(html, snippet) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}`;
}

function ensureInteractiveDeckHtml(inputHtml) {
  let html = inputHtml || "";
  html = ensureFirstSlideActive(html);
  const navLogic = hasNavLogic(html);
  if (!navLogic) html = injectBeforeBodyClose(html, NAV_ENGINE);
  if (!/id="deck-print-patch"/.test(html)) html = injectBeforeBodyClose(html, PRINT_PATCH);
  return { html, navInjected: !navLogic, navLogic: true };
}

module.exports = { ensureInteractiveDeckHtml };
