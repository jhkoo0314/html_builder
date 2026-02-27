"use strict";

const { runNetworkDiagnostics } = require("../src/diagnostics/network");

(async () => {
  try {
    const result = await runNetworkDiagnostics();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`NETWORK_DIAGNOSTICS_FAILED: ${error.message}\n`);
    process.exit(1);
  }
})();
