#!/usr/bin/env node
// Stops the e2e test Firebase emulator stack (test ports only).
// Mirrors stop-emulators.mjs but targets the test hub at port 4402,
// so dev emulators running concurrently on their ports are never touched.
// Hub PID lookup matches by port so it finds the right process even when
// both dev (4400) and test (4402) hubs are alive simultaneously.

import { execSync } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const HUB_PORT = 4402;
const HUB_URL = `http://localhost:${HUB_PORT}/emulators`;
const PORTS = [4402, 8081, 9100, 5002, 5003, 9200];
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
      // Match by port so we don't kill the dev hub (4400) by mistake.
      if (typeof data.pid === "number" && data.port === HUB_PORT) return data.pid;
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

function gracefulKillPorts(ports) {
  for (const port of ports) {
    try {
      execSync(`fuser -k -TERM ${port}/tcp 2>/dev/null`, { stdio: "ignore" });
    } catch {
      // fuser not available or no process on port — best effort
    }
  }
}

async function assertPortsFree() {
  const busy = await getOccupiedPorts();
  if (busy.length === 0) return;
  console.error(
    `stop-test-emulators: ports ${busy.join(", ")} still occupied — environment may be broken.`
  );
  process.exit(1);
}

async function main() {
  if (!(await hubIsRunning())) {
    const busy = await getOccupiedPorts();
    if (busy.length === 0) {
      console.log("stop-test-emulators: no test hub found, nothing to do.");
      process.exit(0);
    }
    console.warn(
      `stop-test-emulators: no hub but ports ${busy.join(", ")} occupied — force-killing orphaned processes...`
    );
    forceKillPorts(busy);
    await new Promise((r) => setTimeout(r, 1000));
    await assertPortsFree();
    console.log("stop-test-emulators: all test ports free after force-kill.");
    process.exit(0);
  }

  const pid = findHubPid();
  if (pid === null) {
    const busy = await getOccupiedPorts();
    console.warn(
      `stop-test-emulators: hub responding but locator file not found — sending SIGTERM via fuser to ports ${busy.join(", ")}...`
    );
    gracefulKillPorts(busy);
    if (await waitForPorts()) {
      console.log("stop-test-emulators: all test ports free, emulators stopped.");
      process.exit(0);
    }
    console.warn(
      `stop-test-emulators: SIGTERM timed out after ${TIMEOUT_MS / 1000}s — escalating to SIGKILL (fuser -k)...`
    );
    forceKillPorts(await getOccupiedPorts());
    await new Promise((r) => setTimeout(r, 1000));
    await assertPortsFree();
    console.log("stop-test-emulators: all test ports free after force-kill.");
    process.exit(0);
  }

  console.log(`stop-test-emulators: sending SIGTERM to test hub process (pid ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
    console.log("stop-test-emulators: hub process already gone, checking ports...");
  }

  if (await waitForPorts()) {
    console.log("stop-test-emulators: all test ports free, emulators stopped.");
    process.exit(0);
  }

  console.warn(
    `stop-test-emulators: SIGTERM timed out after ${TIMEOUT_MS / 1000}s — escalating to SIGKILL (pid ${pid})...`
  );
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // process already gone
  }

  if (await waitForPorts(SIGKILL_TIMEOUT_MS)) {
    console.log("stop-test-emulators: all test ports free after SIGKILL.");
    process.exit(0);
  }

  const busy = await getOccupiedPorts();
  console.warn(
    `stop-test-emulators: ports ${busy.join(", ")} still occupied after SIGKILL — force-killing orphaned processes...`
  );
  forceKillPorts(busy);
  await new Promise((r) => setTimeout(r, 1000));
  await assertPortsFree();
  console.log("stop-test-emulators: all test ports free after force-kill.");
  process.exit(0);
}

main();
