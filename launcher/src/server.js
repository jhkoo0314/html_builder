"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { StatusStore } = require("./statusStore");
const { ProcessManager } = require("./processManager");

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const app = express();
const repoRoot = path.resolve(__dirname, "..", "..");
const launcherPort = intEnv("LAUNCHER_PORT", 5170);
const artifactsRoot = process.env.ARTIFACTS_ROOT || path.join(repoRoot, ".artifacts");
const healthCheckIntervalMs = intEnv("HEALTH_CHECK_INTERVAL_MS", 2000);
const healthCheckTimeoutMs = intEnv("HEALTH_CHECK_TIMEOUT_MS", 800);
const healthCheckStartupGraceMs = intEnv("HEALTH_CHECK_STARTUP_GRACE_MS", 30000);
const healthFailureThreshold = intEnv("HEALTH_FAILURE_THRESHOLD", 3);
const unhealthySustainMs = intEnv("UNHEALTHY_SUSTAIN_MS", 10000);
const restartMaxAttempts = intEnv("RESTART_MAX_ATTEMPTS", 5);
const restartWindowMs = intEnv("RESTART_WINDOW_MS", 300000);
const restartBackoffBaseMs = intEnv("RESTART_BACKOFF_BASE_MS", 500);

if (!fs.existsSync(artifactsRoot)) {
  fs.mkdirSync(artifactsRoot, { recursive: true });
}

const services = [
  {
    key: "L1",
    label: "L1",
    cwd: process.env.L1_DIR || path.join(repoRoot, "layer1-report2text"),
    port: intEnv("L1_PORT", 5171),
    command: "npm.cmd",
    args: ["start"],
  },
  {
    key: "L2",
    label: "L2",
    cwd: process.env.L2_DIR || path.join(repoRoot, "layer2-stable"),
    port: intEnv("L2_PORT", 5172),
    command: "npm.cmd",
    args: ["start"],
  },
  {
    key: "L3",
    label: "L3",
    cwd: process.env.L3_DIR || path.join(repoRoot, "layer3-advanced"),
    port: intEnv("L3_PORT", 5173),
    command: "npm.cmd",
    args: ["start"],
  },
];

const statusStore = new StatusStore(services.map((item) => item.key));
const manager = new ProcessManager({
  services,
  statusStore,
  artifactsRoot,
  healthCheckIntervalMs,
  healthCheckTimeoutMs,
  healthCheckStartupGraceMs,
  healthFailureThreshold,
  unhealthySustainMs,
  restartMaxAttempts,
  restartWindowMs,
  restartBackoffBaseMs,
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    launcher: {
      port: launcherPort,
      artifactsRoot,
      pid: process.pid,
      startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
      uptimeMs: Math.floor(process.uptime() * 1000),
      healthCheckIntervalMs,
      healthCheckTimeoutMs,
      healthCheckStartupGraceMs,
      healthFailureThreshold,
      unhealthySustainMs,
      restartMaxAttempts,
      restartWindowMs,
      restartBackoffBaseMs,
    },
    services: statusStore.getStatusSnapshot(),
  });
});

app.get("/api/logs", (req, res) => {
  const service = String(req.query.service || "").toUpperCase();
  if (!["L1", "L2", "L3"].includes(service)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid service. Use one of: L1, L2, L3",
    });
  }
  return res.json({
    ok: true,
    service,
    lines: statusStore.getServiceLogs(service),
  });
});

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    service: "launcher",
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
  });
});

const httpServer = app.listen(launcherPort, () => {
  process.stdout.write(`Launcher listening on http://localhost:${launcherPort}\n`);
  manager.startAll();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`Launcher shutdown requested (${signal})\n`);
  try {
    await manager.shutdownAll();
  } finally {
    httpServer.close(() => process.exit(0));
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
