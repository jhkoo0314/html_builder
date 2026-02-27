"use strict";

const dns = require("dns").promises;
const https = require("https");

const TARGET_HOST = "generativelanguage.googleapis.com";
const TARGET_URL = "https://generativelanguage.googleapis.com/";

function httpsProbe(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = https.get(url, (res) => {
      res.resume();
      resolve({
        ok: true,
        statusCode: res.statusCode || 0,
        statusMessage: res.statusMessage || "",
        ms: Date.now() - startedAt,
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("HTTPS_TIMEOUT"));
    });

    req.on("error", (error) => {
      resolve({
        ok: false,
        error: String(error && error.message ? error.message : error),
        code: error && error.code ? String(error.code) : "",
        ms: Date.now() - startedAt,
      });
    });
  });
}

async function runNetworkDiagnostics() {
  const out = {
    targetHost: TARGET_HOST,
    targetUrl: TARGET_URL,
    nodeVersion: process.version,
    fetchAvailable: typeof fetch === "function",
    undiciVersion: process.versions && process.versions.undici ? process.versions.undici : "",
    proxy: {
      HTTPS_PROXY: process.env.HTTPS_PROXY || "",
      HTTP_PROXY: process.env.HTTP_PROXY || "",
      NO_PROXY: process.env.NO_PROXY || "",
    },
    dns: { ok: false, addresses: [], error: "", code: "" },
    https: { ok: false, statusCode: 0, statusMessage: "", error: "", code: "", ms: 0 },
    checkedAt: new Date().toISOString(),
  };

  try {
    const records = await dns.lookup(TARGET_HOST, { all: true });
    out.dns.ok = true;
    out.dns.addresses = records.map((x) => ({ address: x.address, family: x.family }));
  } catch (error) {
    out.dns.ok = false;
    out.dns.error = String(error && error.message ? error.message : error);
    out.dns.code = error && error.code ? String(error.code) : "";
  }

  const httpsResult = await httpsProbe(TARGET_URL, 8000);
  out.https = {
    ok: Boolean(httpsResult.ok),
    statusCode: httpsResult.statusCode || 0,
    statusMessage: httpsResult.statusMessage || "",
    error: httpsResult.error || "",
    code: httpsResult.code || "",
    ms: httpsResult.ms || 0,
  };

  return out;
}

module.exports = { runNetworkDiagnostics };
