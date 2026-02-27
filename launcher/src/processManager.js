"use strict";

const fs = require("fs");
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
  constructor({ services, statusStore, artifactsRoot }) {
    this.services = services;
    this.serviceMap = new Map(services.map((svc) => [svc.key, svc]));
    this.statusStore = statusStore;
    this.artifactsRoot = artifactsRoot;
    this.children = new Map();
    this.shuttingDown = false;
  }

  startAll() {
    this.services.forEach((service) => {
      this.startService(service.key);
    });
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

    this.bindStreamLogs(service, child, "stdout");
    this.bindStreamLogs(service, child, "stderr");

    child.once("spawn", () => {
      // Phase 1 has no health polling yet. Running process is treated as healthy.
      this.statusStore.setStatus(serviceKey, "healthy", { pid: child.pid });
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
      this.statusStore.setStatus(serviceKey, this.shuttingDown ? "stopped" : "crashed", {
        pid: null,
      });
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
