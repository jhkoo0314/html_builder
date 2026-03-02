"use strict";

const express = require("express");
const http = require("http");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendProxyError(res, status, code, message, target, detail) {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      target,
      detail: detail || null,
    },
  });
}

async function proxyPost(req, res, options) {
  const { host, port, path, timeoutMs, target } = options;
  const body = await readBody(req);

  return new Promise((resolve) => {
    const upstream = http.request(
      {
        host,
        port,
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          ...req.headers,
          host: `${host}:${port}`,
          "content-length": String(body.length),
        },
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", (chunk) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          const raw = Buffer.concat(chunks);
          const contentType = String(upstreamRes.headers["content-type"] || "application/json");
          res.status(upstreamRes.statusCode || 502);
          res.setHeader("content-type", contentType);
          res.send(raw);
          resolve();
        });
      }
    );

    upstream.on("timeout", () => {
      upstream.destroy();
      sendProxyError(res, 504, "UPSTREAM_TIMEOUT", "Upstream request timed out", target, {
        timeoutMs,
      });
      resolve();
    });

    upstream.on("error", (error) => {
      sendProxyError(res, 502, "UPSTREAM_UNREACHABLE", "Failed to reach upstream service", target, {
        code: error.code || null,
        message: error.message,
      });
      resolve();
    });

    upstream.write(body);
    upstream.end();
  });
}

function createProxyRoutes(config) {
  const { l2Port, l3Port, proxyTimeoutMs = 180000 } = config;
  const router = express.Router();

  router.post("/run/l2/build", async (req, res) => {
    await proxyPost(req, res, {
      host: "127.0.0.1",
      port: l2Port,
      path: "/api/generate-llm",
      timeoutMs: proxyTimeoutMs,
      target: "L2 /api/generate-llm",
    });
  });

  router.post("/run/l3/build-direct", async (req, res) => {
    await proxyPost(req, res, {
      host: "127.0.0.1",
      port: l3Port,
      path: "/api/l3/build-direct",
      timeoutMs: proxyTimeoutMs,
      target: "L3 /api/l3/build-direct",
    });
  });

  router.post("/run/l3/build-from-run", async (req, res) => {
    await proxyPost(req, res, {
      host: "127.0.0.1",
      port: l3Port,
      path: "/api/l3/build-from-run",
      timeoutMs: proxyTimeoutMs,
      target: "L3 /api/l3/build-from-run",
    });
  });

  return router;
}

module.exports = {
  createProxyRoutes,
};
