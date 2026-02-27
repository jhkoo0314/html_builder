"use strict";

function extractHtmlFromText(raw) {
  if (!raw) return { html: "", extractionMethod: "none" };

  const fenced = raw.match(/```html\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return { html: fenced[1].trim(), extractionMethod: "fenced" };
  }

  const doctypeStart = raw.search(/<!doctype html/i);
  if (doctypeStart >= 0) {
    const tail = raw.slice(doctypeStart);
    const closeIndex = tail.toLowerCase().lastIndexOf("</html>");
    if (closeIndex >= 0) {
      return {
        html: tail.slice(0, closeIndex + 7).trim(),
        extractionMethod: "doctype",
      };
    }
  }

  const htmlMatch = raw.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch && htmlMatch[0]) {
    return { html: htmlMatch[0].trim(), extractionMethod: "htmlTag" };
  }

  return { html: "", extractionMethod: "none" };
}

module.exports = { extractHtmlFromText };
