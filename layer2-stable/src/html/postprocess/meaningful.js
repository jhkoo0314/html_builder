"use strict";

function countSlides(html) {
  const matches = (html || "").match(/<section\b/gi);
  return matches ? matches.length : 0;
}

function hasNavLogic(html) {
  if (!html) return false;
  const text = html;
  const hasKeyboard = /addEventListener\(\s*["']keydown["']/i.test(text) || /ArrowRight|ArrowLeft|PageDown|PageUp|Home|End/.test(text);
  const hasSlideFn = /\b(show|nextSlide|prevSlide|goToSlide)\s*\(/i.test(text);
  const hasClickBind = /addEventListener\(\s*["']click["']/i.test(text) || /onclick\s*=/.test(text);
  return hasKeyboard || hasSlideFn || hasClickBind;
}

function detectNavRequired(html) {
  return countSlides(html) >= 2;
}

function isMeaningfulHtml(html) {
  if (!html || html.length < 200) return false;
  if (!/<html[\s>]/i.test(html) && !/<section\b/i.test(html)) return false;
  return countSlides(html) >= 2;
}

module.exports = {
  countSlides,
  hasNavLogic,
  detectNavRequired,
  isMeaningfulHtml,
};
