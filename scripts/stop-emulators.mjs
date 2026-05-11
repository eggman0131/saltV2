#!/usr/bin/env node
// Gracefully stops Firebase emulators via SIGTERM to the hub process.
// SIGTERM lets the hub run its cleanup handlers, including --export-on-exit,
// so dev data in .emulator-data/ is preserved.
// Exits 0 in all cases — including when no hub is running — so CI is unaffected.

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const HUB_URL = "http://localhost:4400/emulators";
const PORTS = [8080, 9099];
const TIMEOUT_MS = 30_000;
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

async function waitForPorts() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const checks = await Promise.all(PORTS.map(portIsFree));
    if (checks.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  if (!(await hubIsRunning())) {
    console.log("stop-emulators: no hub found, nothing to do.");
    process.exit(0);
  }

  const pid = findHubPid();
  if (pid === null) {
    console.warn("stop-emulators: hub is running but locator file not found — cannot send SIGTERM.");
    process.exit(0);
  }

  console.log(`stop-emulators: sending SIGTERM to hub process (pid ${pid})...`);
  process.kill(pid, "SIGTERM");

  const freed = await waitForPorts();
  if (freed) {
    console.log("stop-emulators: all ports free, emulators stopped.");
  } else {
    console.warn(
      `stop-emulators: timed out after ${TIMEOUT_MS / 1000}s waiting for ports ${PORTS.join(", ")} — proceeding anyway.`
    );
  }
  process.exit(0);
}

main();
