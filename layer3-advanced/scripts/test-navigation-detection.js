"use strict";

const { hasNavLogic } = require("../src/html/postprocess/meaningful");
const { ensureInteractiveDeckHtml } = require("../src/html/postprocess/navigation");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const progressOnly = `<!doctype html><html><body><div class="progress-bar"></div><section>A</section><section>B</section></body></html>`;
  assert(hasNavLogic(progressOnly) === false, "progress-only should not be nav logic");

  const altButtons = `<!doctype html><html><body><section>A</section><section>B</section><div class="nav-ui"><button id="prevBtn">Prev</button><button id="nextBtn">Next</button></div></body></html>`;
  const out = ensureInteractiveDeckHtml(altButtons).html;
  assert(/deck-nav-engine/.test(out), "nav engine should be injected");
  process.stdout.write("Navigation detection test passed\n");
}

main();
