"use strict";

async function extractTextFromPdf(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(file.buffer);
  const doc = await pdfjs.getDocument({ data }).promise;

  const chunks = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((x) => x.str).join(" ");
    chunks.push(line);
  }

  return chunks.join("\n");
}

module.exports = { extractTextFromPdf };
