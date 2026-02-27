"use strict";

const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { spawnSync } = require("child_process");

const SHUTDOWN_GRACE_MS = 5000;

function splitLines(buffered, chunk) {
  const text = buffered + chunk.toString("utf8");
  const parts = text.split(/\r?\n/);
  const rest = parts.pop() || "";
  return { lines: parts, rest };
}

class ProcessManager {
  constructor({
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
  }) {
    this.services = services;
    this.serviceMap = new Map(services.map((svc) => [svc.key, svc]));
    this.statusStore = statusStore;
    this.artifactsRoot = artifactsRoot;
    this.children = new Map();
    this.shuttingDown = false;
    this.healthTimer = null;
    this.healthPollInFlight = false;
    this.restartTimers = new Map();
    this.healthRuntime = new Map();
    this.restartHistory = new Map();

    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.healthCheckTimeoutMs = healthCheckTimeoutMs;
    this.healthCheckStartupGraceMs = healthCheckStartupGraceMs;
    this.healthFailureThreshold = healthFailureThreshold;
    this.unhealthySustainMs = unhealthySustainMs;
    this.restartMaxAttempts = restartMaxAttempts;
    this.restartWindowMs = restartWindowMs;
    this.restartBackoffBaseMs = restartBackoffBaseMs;

    if (!Number.isFinite(this.healthCheckIntervalMs) || this.healthCheckIntervalMs <= 0) {
      this.healthCheckIntervalMs = 2000;
    }
    if (!Number.isFinite(this.healthCheckTimeoutMs) || this.healthCheckTimeoutMs <= 0) {
      this.healthCheckTimeoutMs = 800;
    }
    if (!Number.isFinite(this.healthCheckStartupGraceMs) || this.healthCheckStartupGraceMs < 0) {
      this.healthCheckStartupGraceMs = 30000;
    }
    if (!Number.isFinite(this.healthFailureThreshold) || this.healthFailureThreshold <= 0) {
      this.healthFailureThreshold = 3;
    }
    if (!Number.isFinite(this.unhealthySustainMs) || this.unhealthySustainMs < 0) {
      this.unhealthySustainMs = 10000;
    }
    if (!Number.isFinite(this.restartMaxAttempts) || this.restartMaxAttempts <= 0) {
      this.restartMaxAttempts = 5;
    }
    if (!Number.isFinite(this.restartWindowMs) || this.restartWindowMs <= 0) {
      this.restartWindowMs = 300000;
    }
    if (!Number.isFinite(this.restartBackoffBaseMs) || this.restartBackoffBaseMs <= 0) {
      this.restartBackoffBaseMs = 500;
    }

    this.services.forEach((service) => {
      this.healthRuntime.set(service.key, {
        consecutiveFailures: 0,
        startupGraceUntil: 0,
        unhealthySince: null,
      });
      this.restartHistory.set(service.key, []);
    });
  }

  startAll() {
    this.services.forEach((service) => {
      this.startService(service.key);
    });
    this.startHealthPolling();
  }

  getHealthRuntime(serviceKey) {
    return this.healthRuntime.get(serviceKey) || {
      consecutiveFailures: 0,
      startupGraceUntil: 0,
      unhealthySince: null,
    };
  }

  setHealthRuntime(serviceKey, patch) {
    const current = this.getHealthRuntime(serviceKey);
    this.healthRuntime.set(serviceKey, {
      ...current,
      ...patch,
    });
  }

  startHealthPolling() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      this.pollAllHealth().catch((error) => {
        process.stderr.write(`[health] poll error: ${error.message}\n`);
      });
    }, this.healthCheckIntervalMs);
  }

  startService(serviceKey) {
    const service = this.services.find((item) => item.key === serviceKey);
    if (!service) return;

    const commandLine = [service.command, ...service.args].join(" ");
    const exists = fs.existsSync(service.cwd);
    this.statusStore.setStatus(serviceKey, exists ? "starting" : "failed", {
      pid: null,
      startedAt: null,
      port: service.port,
      command: commandLine,
      cwd: service.cwd,
    });

    if (!exists) {
      const missing = `[${service.label}] failed: missing cwd ${service.cwd}`;
      this.statusStore.appendLog(serviceKey, missing);
      process.stderr.write(`${missing}\n`);
      return;
    }

    const env = {
      ...process.env,
      PORT: String(service.port),
      ARTIFACTS_ROOT: this.artifactsRoot,
    };

    let child;
    try {
      if (process.platform === "win32") {
        child = spawn(`${service.command} ${service.args.join(" ")}`, {
          cwd: service.cwd,
          env,
          shell: true,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        child = spawn(service.command, service.args, {
          cwd: service.cwd,
          env,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (error) {
      const line = `[${service.label}] spawn exception: ${error.message}`;
      this.statusStore.appendLog(serviceKey, line);
      process.stderr.write(`${line}\n`);
      this.statusStore.setStatus(serviceKey, "failed", { pid: null });
      return;
    }

    this.children.set(serviceKey, child);
    this.statusStore.setStatus(serviceKey, "starting", {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      port: service.port,
      command: commandLine,
      cwd: service.cwd,
    });
    this.setHealthRuntime(serviceKey, {
      consecutiveFailures: 0,
      unhealthySince: null,
      startupGraceUntil: Date.now() + this.healthCheckStartupGraceMs,
    });

    this.bindStreamLogs(service, child, "stdout");
    this.bindStreamLogs(service, child, "stderr");

    child.once("spawn", () => {
      this.statusStore.setStatus(serviceKey, "starting", { pid: child.pid });
    });

    child.once("error", (error) => {
      const line = `[${service.label}] spawn error: ${error.message}`;
      this.statusStore.appendLog(serviceKey, line);
      process.stderr.write(`${line}\n`);
      this.statusStore.setStatus(serviceKey, "failed", { pid: null });
      this.children.delete(serviceKey);
    });

    child.once("exit", (code, signal) => {
      this.children.delete(serviceKey);
      const line = `[${service.label}] exited code=${String(code)} signal=${String(signal)}`;
      this.statusStore.appendLog(serviceKey, line);
      process.stdout.write(`${line}\n`);
      const nextStatus = this.shuttingDown ? "stopped" : "crashed";
      this.statusStore.setStatus(serviceKey, nextStatus, {
        pid: null,
      });
      if (!this.shuttingDown) {
        this.scheduleRestart(serviceKey, "exit");
      }
    });
  }

  bindStreamLogs(service, child, streamType) {
    const stream = child[streamType];
    if (!stream) return;
    let rest = "";
    stream.on("data", (chunk) => {
      const parsed = splitLines(rest, chunk);
      rest = parsed.rest;
      parsed.lines.forEach((line) => {
        const prefixed = `[${service.label}] ${line}`;
        this.statusStore.appendLog(service.key, prefixed);
        process.stdout.write(`${prefixed}\n`);
      });
    });
    stream.on("end", () => {
      if (!rest.trim()) return;
      const prefixed = `[${service.label}] ${rest}`;
      this.statusStore.appendLog(service.key, prefixed);
      process.stdout.write(`${prefixed}\n`);
      rest = "";
    });
  }

  async shutdownAll() {
    this.shuttingDown = true;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();

    const entries = Array.from(this.children.entries());
    entries.forEach(([serviceKey, child]) => {
      if (!child || child.killed) return;
      try {
        this.terminateChild(child, false);
        const service = this.serviceMap.get(serviceKey);
        if (service && service.port) {
          this.terminateByPort(service.port, true);
        }
        this.statusStore.setStatus(serviceKey, "stopping");
      } catch (error) {
        const line = `[${serviceKey}] SIGTERM error: ${error.message}`;
        this.statusStore.appendLog(serviceKey, line);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));

    const pending = Array.from(this.children.entries());
    pending.forEach(([serviceKey, child]) => {
      if (!child || child.killed) return;
      try {
        this.terminateChild(child, true);
        const service = this.serviceMap.get(serviceKey);
        if (service && service.port) {
          this.terminateByPort(service.port, true);
        }
        this.statusStore.setStatus(serviceKey, "stopped");
      } catch (error) {
        const line = `[${serviceKey}] SIGKILL error: ${error.message}`;
        this.statusStore.appendLog(serviceKey, line);
      }
    });

    // Some Windows wrapper processes can exit early while real server processes remain.
    // Always enforce a final by-port cleanup for all registered services.
    if (process.platform === "win32") {
      this.services.forEach((service) => {
        if (!service || !service.port) return;
        this.terminateByPort(service.port, true);
      });
    }
  }

  async pollAllHealth() {
    if (this.shuttingDown) return;
    if (this.healthPollInFlight) return;
    this.healthPollInFlight = true;
    try {
      await Promise.all(this.services.map((service) => this.pollServiceHealth(service)));
    } finally {
      this.healthPollInFlight = false;
    }
  }

  async pollServiceHealth(service) {
    const serviceKey = service.key;
    const state = this.getHealthRuntime(serviceKey);
    const now = Date.now();
    const inGrace = now < state.startupGraceUntil;

    const child = this.children.get(serviceKey);
    if (!child && !this.shuttingDown) {
      this.statusStore.setHealthState(serviceKey, {
        ok: false,
        code: null,
        error: "NO_PROCESS",
        consecutiveFailures: state.consecutiveFailures,
        unhealthySince: state.unhealthySince,
      });
      this.scheduleRestart(serviceKey, "no-process");
      return;
    }

    const health = await this.fetchHealth(service.port);
    if (health.ok) {
      this.setHealthRuntime(serviceKey, {
        consecutiveFailures: 0,
        unhealthySince: null,
      });
      this.statusStore.setHealthState(serviceKey, {
        ok: true,
        code: health.code,
        error: null,
        consecutiveFailures: 0,
        unhealthySince: null,
      });
      this.statusStore.setStatus(serviceKey, "healthy");
      return;
    }

    if (inGrace) {
      this.statusStore.setHealthState(serviceKey, {
        ok: false,
        code: health.code,
        error: health.error || "STARTUP_GRACE",
        consecutiveFailures: state.consecutiveFailures,
        unhealthySince: state.unhealthySince,
      });
      this.statusStore.setStatus(serviceKey, "starting");
      return;
    }

    const nextFailures = (state.consecutiveFailures || 0) + 1;
    let nextUnhealthySince = state.unhealthySince;
    if (nextFailures >= this.healthFailureThreshold && !nextUnhealthySince) {
      nextUnhealthySince = now;
    }
    this.setHealthRuntime(serviceKey, {
      consecutiveFailures: nextFailures,
      unhealthySince: nextUnhealthySince,
    });
    this.statusStore.setHealthState(serviceKey, {
      ok: false,
      code: health.code,
      error: health.error || "HEALTH_FAILED",
      consecutiveFailures: nextFailures,
      unhealthySince: nextUnhealthySince ? new Date(nextUnhealthySince).toISOString() : null,
    });

    if (nextFailures >= this.healthFailureThreshold) {
      this.statusStore.setStatus(serviceKey, "unhealthy", {
        unhealthySince: nextUnhealthySince ? new Date(nextUnhealthySince).toISOString() : null,
      });
      if (nextUnhealthySince && now - nextUnhealthySince >= this.unhealthySustainMs) {
        this.scheduleRestart(serviceKey, "unhealthy-sustain");
      }
    }
  }

  fetchHealth(port) {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/healthz",
          timeout: this.healthCheckTimeoutMs,
        },
        (res) => {
          const code = Number(res.statusCode || 0);
          res.resume();
          resolve({
            ok: code >= 200 && code < 300,
            code,
            error: code >= 200 && code < 300 ? null : `HTTP_${code}`,
          });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, code: null, error: "TIMEOUT" });
      });
      req.on("error", (error) => {
        resolve({ ok: false, code: null, error: error.code || error.message || "REQUEST_ERROR" });
      });
    });
  }

  scheduleRestart(serviceKey, reason) {
    if (this.shuttingDown) return;
    if (this.restartTimers.has(serviceKey)) return;
    const service = this.serviceMap.get(serviceKey);
    if (!service) return;

    const now = Date.now();
    const history = (this.restartHistory.get(serviceKey) || []).filter(
      (ts) => now - ts <= this.restartWindowMs
    );

    if (history.length >= this.restartMaxAttempts) {
      this.restartHistory.set(serviceKey, history);
      this.statusStore.setStatus(serviceKey, "failed");
      this.statusStore.appendLog(
        serviceKey,
        `[${service.label}] restart blocked: max attempts exceeded (${this.restartMaxAttempts}/${this.restartWindowMs}ms)`
      );
      return;
    }

    const attempt = history.length + 1;
    history.push(now);
    this.restartHistory.set(serviceKey, history);
    this.statusStore.incrementRestartCount(serviceKey);

    const jitter = Math.floor(Math.random() * 251);
    const delay = this.restartBackoffBaseMs * 2 ** (attempt - 1) + jitter;
    this.statusStore.appendLog(
      serviceKey,
      `[${service.label}] restart scheduled in ${delay}ms (attempt ${attempt}, reason=${reason})`
    );

    const timer = setTimeout(() => {
      this.restartTimers.delete(serviceKey);
      if (this.shuttingDown) return;
      const old = this.children.get(serviceKey);
      if (old && !old.killed) {
        this.terminateChild(old, true);
      }
      this.startService(serviceKey);
    }, delay);
    this.restartTimers.set(serviceKey, timer);
  }

  terminateChild(child, force) {
    if (!child || !child.pid) return;
    if (process.platform === "win32") {
      const args = ["/PID", String(child.pid), "/T"];
      if (force) args.push("/F");
      spawnSync("taskkill", args, {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
      return;
    }
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }

  terminateByPort(port, force) {
    if (process.platform !== "win32") return;
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    const output = String(result.stdout || "");
    const ids = new Set();
    const marker = `:${String(port)}`;
    output.split(/\r?\n/).forEach((line) => {
      if (!line.includes(marker) || !line.includes("LISTENING")) return;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) ids.add(pid);
    });
    ids.forEach((pid) => {
      const args = ["/PID", String(pid), "/T"];
      if (force) args.push("/F");
      spawnSync("taskkill", args, {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
    });
  }
}

module.exports = {
  ProcessManager,
  SHUTDOWN_GRACE_MS,
};
