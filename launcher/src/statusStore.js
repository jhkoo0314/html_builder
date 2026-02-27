"use strict";

const MAX_LOG_LINES = 200;

function nowIso() {
  return new Date().toISOString();
}

class StatusStore {
  constructor(serviceKeys) {
    this.services = new Map();
    this.logs = new Map();

    serviceKeys.forEach((key) => {
      this.services.set(key, {
        status: "starting",
        pid: null,
        startedAt: null,
        updatedAt: nowIso(),
        restartCount: 0,
        port: null,
        command: null,
        cwd: null,
        lastHealthAt: null,
        lastHealthOk: null,
        lastHealthCode: null,
        lastHealthError: null,
        consecutiveFailures: 0,
        unhealthySince: null,
      });
      this.logs.set(key, []);
    });
  }

  setServiceMeta(key, meta) {
    const current = this.services.get(key);
    if (!current) return;
    this.services.set(key, {
      ...current,
      ...meta,
      updatedAt: nowIso(),
    });
  }

  setStatus(key, status, extra = {}) {
    this.setServiceMeta(key, {
      ...extra,
      status,
    });
  }

  incrementRestartCount(key) {
    const current = this.services.get(key);
    if (!current) return;
    this.setServiceMeta(key, {
      restartCount: (current.restartCount || 0) + 1,
    });
  }

  setHealthState(key, health) {
    const current = this.services.get(key);
    if (!current) return;
    this.setServiceMeta(key, {
      lastHealthAt: nowIso(),
      lastHealthOk: Boolean(health.ok),
      lastHealthCode: health.code == null ? null : health.code,
      lastHealthError: health.error || null,
      consecutiveFailures:
        typeof health.consecutiveFailures === "number"
          ? health.consecutiveFailures
          : current.consecutiveFailures || 0,
      unhealthySince:
        health.unhealthySince === undefined ? current.unhealthySince || null : health.unhealthySince,
    });
  }

  appendLog(key, line) {
    const currentLogs = this.logs.get(key);
    if (!currentLogs) return;
    currentLogs.push({
      ts: nowIso(),
      line,
    });
    if (currentLogs.length > MAX_LOG_LINES) {
      currentLogs.splice(0, currentLogs.length - MAX_LOG_LINES);
    }
  }

  getStatusSnapshot() {
    const entries = {};
    for (const [key, value] of this.services.entries()) {
      entries[key] = { ...value };
    }
    return entries;
  }

  getServiceLogs(key) {
    const logs = this.logs.get(key) || [];
    return logs.slice();
  }
}

module.exports = {
  StatusStore,
  MAX_LOG_LINES,
};
