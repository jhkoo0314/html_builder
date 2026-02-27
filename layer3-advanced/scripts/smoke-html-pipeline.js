"use strict";

const { extractHtmlFromText } = require("../src/html/extract/extractHtmlFromText");
const { finalizeHtmlDocument } = require("../src/html/finalize/finalizeHtmlDocument");
const { ensureInteractiveDeckHtml } = require("../src/html/postprocess/navigation");
const { countSlides, hasNavLogic } = require("../src/html/postprocess/meaningful");

const sampleRaw = `<!doctype html><html><head><meta charset="utf-8"></head><body><section>One</section><section>Two</section></body></html>`;

function main() {
  const ex = extractHtmlFromText(sampleRaw);
  const fin = finalizeHtmlDocument(ex.html);
  const nav = ensureInteractiveDeckHtml(fin.html);
  const slides = countSlides(nav.html);
  const ok = slides >= 2 && hasNavLogic(nav.html) && /<html[\s\S]*<\/html>/i.test(nav.html);
  if (!ok) {
    process.stderr.write("Smoke test failed\n");
    process.exit(1);
  }
  process.stdout.write("Smoke test passed\n");
}

main();
