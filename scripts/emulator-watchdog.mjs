#!/usr/bin/env node
// Detached watchdog that survives SIGKILL of its launching process.
// Polls a runner PID; when the runner is gone, runs stop-emulators and exits.
// Used by Playwright globalSetup so that test emulators are cleaned up even
// when the VS Code Playwright extension force-kills its worker between runs
// (in that case neither globalTeardown nor process.on('exit') can fire).

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const RUNNER_PID = Number(process.argv[2]);
const POLL_MS = 1000;

if (!RUNNER_PID || Number.isNaN(RUNNER_PID)) {
  console.error("emulator-watchdog: missing or invalid runner PID");
  process.exit(1);
}

const STOP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "stop-emulators.mjs"
);

function runnerAlive() {
  try {
    process.kill(RUNNER_PID, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

(async function loop() {
  while (runnerAlive()) {
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    execFileSync("node", [STOP_SCRIPT], { stdio: "inherit" });
  } catch {
    // best effort — stop-emulators handles its own escalation/exit codes
  }
})();
