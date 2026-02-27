"use strict";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  const baseUrl = process.env.L3_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3303}`;
  const endpoint = `${baseUrl}/api/l3/build-direct`;

  const sampleText = [
    "L3 direct smoke sample",
    "",
    "Topic A: Operational goals and KPIs.",
    "Topic B: Risks and mitigations with timeline.",
    "Topic C: Next actions and owners.",
  ].join("\n");

  const form = new FormData();
  form.append("documents", new Blob([sampleText], { type: "text/plain" }), "smoke-l3.txt");

  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`HTTP ${response.status}: ${json.message || json.error || "build-direct failed"}`);
  }

  const runId = json.runId;
  const variant = (json.htmlVariants && json.htmlVariants[0]) || {};
  const meta = variant.meta || {};
  const status = json.status || meta.status || "N/A";
  const slideCount = Number(meta.slideCount || 0);

  if (!runId) fail("Missing runId");
  if (status !== "SUCCESS") fail(`Unexpected status=${status}`);
  if (slideCount < 2) fail(`slideCount too small: ${slideCount}`);

  const analysis = json.analysis || {};
  if (!analysis || !analysis.docTitle || !Array.isArray(analysis.slidePlan)) {
    fail("Missing analysis payload");
  }

  process.stdout.write(`PASS runId=${runId} status=${status} slideCount=${slideCount}\n`);
}

main().catch((error) => fail(error.message || String(error)));
