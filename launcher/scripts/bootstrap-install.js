"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const targets = ["launcher", "layer1-report2text", "layer2-stable", "layer3-advanced"];

for (const target of targets) {
  const cwd = path.join(repoRoot, target);
  process.stdout.write(`[bootstrap] npm install in ${cwd}\n`);
  const result = spawnSync("npm.cmd", ["install"], {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

