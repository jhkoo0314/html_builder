"use strict";

class L3BuildError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

module.exports = {
  L3BuildError,
};

