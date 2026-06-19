#!/usr/bin/env node
// Gracefully stops Firebase emulators via SIGTERM to the hub (CLI) process.
// SIGTERM to the firebase CLI lets it run its cleanup handlers, including
// --export-on-exit, so dev data in .emulator-data/ is preserved. Signalling the
// JVM children directly would NOT trigger export-on-exit, so we always resolve
// and signal the CLI process, never the port children, on the graceful path.
// Escalates to SIGKILL (CLI) then port-level termination for orphaned children
// (e.g. the Firestore JVM) that survive hub teardown.
// Cross-platform: process resolution uses `lsof` (macOS/Linux), not `fuser`
// (which is Linux/WSL-only and has no -k on BSD/macOS).
// Exits 0 when all emulator ports are free; exits 1 if any remain occupied.

import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const HUB_URL = 'http://localhost:4400/emulators';
const PORTS = [4400, 8080, 9099, 5001, 5002, 9199];
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
      const data = JSON.parse(fs.readFileSync(path.join(tmp, file), 'utf8'));
      if (typeof data.pid === 'number') return data.pid;
    } catch {
      // malformed or unreadable locator — skip
    }
  }
  return null;
}

// PIDs of processes LISTENING on a port. Uses lsof so it works on macOS and
// Linux alike (fuser has no -k on BSD/macOS and is unavailable on many setups).
function listeningPids(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    // lsof exits non-zero when nothing matches — no listener on this port.
    return [];
  }
}

// Resolve the firebase CLI (hub) PID: prefer the locator file, fall back to
// whatever is listening on the hub port (4400). This is the process that runs
// --export-on-exit, so it is the one we SIGTERM to preserve data.
function resolveHubPid() {
  const fromLocator = findHubPid();
  if (fromLocator !== null) return fromLocator;
  const [fromPort] = listeningPids(4400);
  return fromPort ?? null;
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // process already gone — best effort
    }
  }
}

// Terminate whatever is listening on the given ports: SIGTERM, wait, then
// SIGKILL survivors. Used only for orphaned children with no live CLI parent
// (export-on-exit is impossible once the CLI is gone), so losing in-memory
// state here is unavoidable, not a regression.
async function terminatePorts(ports) {
  const pids = [...new Set(ports.flatMap(listeningPids))];
  if (pids.length === 0) return;
  killPids(pids, 'SIGTERM');
  if (await waitForPorts(SIGKILL_TIMEOUT_MS)) return;
  killPids([...new Set(ports.flatMap(listeningPids))], 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
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

async function assertPortsFree() {
  const busy = await getOccupiedPorts();
  if (busy.length === 0) return;
  console.error(
    `stop-emulators: ports ${busy.join(', ')} still occupied — environment may be broken.`,
  );
  process.exit(1);
}

async function main() {
  if (!(await hubIsRunning())) {
    const busy = await getOccupiedPorts();
    if (busy.length === 0) {
      console.log('stop-emulators: no hub found, nothing to do.');
      process.exit(0);
    }
    // Orphaned emulator subprocesses (e.g. JVM) survived hub teardown. There is
    // no live CLI to run --export-on-exit, so just terminate them.
    console.warn(
      `stop-emulators: no hub but ports ${busy.join(', ')} occupied — terminating orphaned processes...`,
    );
    await terminatePorts(busy);
    await assertPortsFree();
    console.log('stop-emulators: all ports free after cleanup.');
    process.exit(0);
  }

  // Hub is alive. Signal the firebase CLI process (not the JVM children) so
  // --export-on-exit runs and dev data in .emulator-data/ is preserved.
  const pid = resolveHubPid();
  if (pid === null) {
    // Hub responds but we can't resolve its PID (no locator file and nothing
    // listening on 4400). We can't trigger export-on-exit without the CLI PID;
    // terminate by port so the next startup isn't blocked. Data export is not
    // possible in this rare state.
    const busy = await getOccupiedPorts();
    console.warn(
      `stop-emulators: hub responding but PID unresolved — terminating ports ${busy.join(', ')} (export-on-exit not possible)...`,
    );
    await terminatePorts(busy);
    await assertPortsFree();
    console.log('stop-emulators: all ports free after cleanup.');
    process.exit(0);
  }

  console.log(
    `stop-emulators: sending SIGTERM to hub process (pid ${pid}) — running export-on-exit...`,
  );
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
    console.log('stop-emulators: hub process already gone, checking ports...');
  }

  if (await waitForPorts()) {
    console.log('stop-emulators: all ports free, emulators stopped (data exported).');
    process.exit(0);
  }

  console.warn(
    `stop-emulators: SIGTERM timed out after ${TIMEOUT_MS / 1000}s — escalating to SIGKILL (pid ${pid})...`,
  );
  killPids([pid], 'SIGKILL');

  if (await waitForPorts(SIGKILL_TIMEOUT_MS)) {
    console.log('stop-emulators: all ports free after SIGKILL.');
    process.exit(0);
  }

  // Hub kill didn't free all ports — orphaned child processes (e.g. JVM) remain.
  const busy = await getOccupiedPorts();
  console.warn(
    `stop-emulators: ports ${busy.join(', ')} still occupied after SIGKILL — terminating orphaned processes...`,
  );
  await terminatePorts(busy);
  await assertPortsFree();
  console.log('stop-emulators: all ports free after cleanup.');
  process.exit(0);
}

main();
