"use strict";

function extractTextFromPlain(file) {
  return file.buffer.toString("utf8");
}

module.exports = { extractTextFromPlain };
