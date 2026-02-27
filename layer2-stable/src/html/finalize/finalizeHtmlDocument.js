"use strict";

function stripAfterHtmlClose(html) {
  if (!html) return "";
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf("</html>");
  if (idx < 0) return html;
  return html.slice(0, idx + 7);
}

function ensureCharset(headInner) {
  if (/<meta[^>]+charset\s*=\s*["']?utf-8/i.test(headInner)) return headInner;
  return `<meta charset="utf-8">\n${headInner}`;
}

function finalizeHtmlDocument(inputHtml) {
  let html = stripAfterHtmlClose((inputHtml || "").trim());
  if (!html) {
    html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Deck</title></head><body><main></main></body></html>";
    return { html, finalizeApplied: true };
  }

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>Deck</title></head><body>${html}</body></html>`;
    return { html, finalizeApplied: true };
  }

  if (!/<head[\s>]/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, "<html$1><head><meta charset=\"utf-8\"><title>Deck</title></head>");
  } else {
    html = html.replace(/<head([^>]*)>([\s\S]*?)<\/head>/i, (m, attrs, inner) => `<head${attrs}>${ensureCharset(inner)}</head>`);
  }

  if (!/<body[\s>]/i.test(html)) {
    html = html.replace(/<\/head>/i, "</head><body>");
    if (!/<\/html>/i.test(html)) html += "</html>";
    html = html.replace(/<\/html>/i, "</body></html>");
  } else if (!/<\/body>/i.test(html)) {
    html = html.replace(/<\/html>/i, "</body></html>");
    if (!/<\/html>/i.test(html)) html += "</body></html>";
  }

  if (!/<\/html>/i.test(html)) html += "</html>";

  return { html: stripAfterHtmlClose(html), finalizeApplied: true };
}

module.exports = { stripAfterHtmlClose, finalizeHtmlDocument };
