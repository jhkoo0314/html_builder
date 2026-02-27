"use strict";

function hasContamination(text) {
  const patterns = [
    /<script[^>]*\son\w+=/i,
    /<script[^>]*>[^]*$/i,
    /<style[^>]*>[^]*$/i,
    /="[^"]*$/,
    /='[^']*$/,
  ];
  return patterns.some((p) => p.test(text));
}

function main() {
  const bad = "<div class=\"x\"><script onload=\"alert(1)\">";
  const good = "<!doctype html><html><body><section>ok</section></body></html>";
  if (!hasContamination(bad)) {
    throw new Error("Expected contamination detection for bad input");
  }
  if (hasContamination(good)) {
    throw new Error("Unexpected contamination detection for good input");
  }
  process.stdout.write("Contamination test passed\n");
}

main();
