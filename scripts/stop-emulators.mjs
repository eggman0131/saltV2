#!/usr/bin/env node
// Gracefully stops Firebase emulators via SIGTERM to the hub process.
// SIGTERM lets the hub run its cleanup handlers, including --export-on-exit,
// so dev data in .emulator-data/ is preserved.
// Escalates to SIGKILL (hub) then fuser -k (port-level) for orphaned JVM
// processes that survive hub teardown (common in WSL).
// Exits 0 when all emulator ports are free; exits 1 if any remain occupied.

import { execSync } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const HUB_URL = "http://localhost:4400/emulators";
const PORTS = [8080, 9099, 5001, 5000, 9199];
const TIMEOUT_MS = 30_000;
const SIGKILL_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 500;

async function hubIsRunning() {
  try {
    const res = await fetch(HUB_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findHubPid() {
  const tmp = os.tmpdir();
  const files = fs.readdirSync(tmp).filter((f) => /^hub-.+\.json$/.test(f));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(tmp, file), "utf8"));
      if (typeof data.pid === "number") return data.pid;
    } catch {
      // malformed or unreadable locator — skip
    }
  }
  return null;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function getOccupiedPorts() {
  const results = await Promise.all(PORTS.map(async (p) => ({ p, free: await portIsFree(p) })));
  return results.filter((x) => !x.free).map((x) => x.p);
}

async function waitForPorts(timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checks = await Promise.all(PORTS.map(portIsFree));
    if (checks.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function forceKillPorts(ports) {
  for (const port of ports) {
    try {
      execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: "ignore" });
    } catch {
      // fuser not available or no process on port — best effort
    }
  }
}

async function assertPortsFree() {
  const busy = await getOccupiedPorts();
  if (busy.length === 0) return;
  console.error(
    `stop-emulators: ports ${busy.join(", ")} still occupied — environment may be broken.`
  );
  process.exit(1);
}

async function main() {
  if (!(await hubIsRunning())) {
    const busy = await getOccupiedPorts();
    if (busy.length === 0) {
      console.log("stop-emulators: no hub found, nothing to do.");
      process.exit(0);
    }
    // Orphaned emulator subprocesses (e.g. JVM) survived hub teardown.
    console.warn(
      `stop-emulators: no hub but ports ${busy.join(", ")} occupied — force-killing orphaned processes...`
    );
    forceKillPorts(busy);
    await new Promise((r) => setTimeout(r, 1000));
    await assertPortsFree();
    console.log("stop-emulators: all ports free after force-kill.");
    process.exit(0);
  }

  const pid = findHubPid();
  if (pid === null) {
    console.warn("stop-emulators: hub is running but locator file not found — cannot send SIGTERM.");
    process.exit(0);
  }

  console.log(`stop-emulators: sending SIGTERM to hub process (pid ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
    console.log("stop-emulators: hub process already gone, checking ports...");
  }

  if (await waitForPorts()) {
    console.log("stop-emulators: all ports free, emulators stopped.");
    process.exit(0);
  }

  console.warn(
    `stop-emulators: SIGTERM timed out after ${TIMEOUT_MS / 1000}s — escalating to SIGKILL (pid ${pid})...`
  );
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // process already gone
  }

  if (await waitForPorts(SIGKILL_TIMEOUT_MS)) {
    console.log("stop-emulators: all ports free after SIGKILL.");
    process.exit(0);
  }

  // Hub kill didn't free all ports — orphaned child processes (e.g. JVM) remain.
  const busy = await getOccupiedPorts();
  console.warn(`stop-emulators: ports ${busy.join(", ")} still occupied after SIGKILL — force-killing orphaned processes...`);
  forceKillPorts(busy);
  await new Promise((r) => setTimeout(r, 1000));
  await assertPortsFree();
  console.log("stop-emulators: all ports free after force-kill.");
  process.exit(0);
}

main();
