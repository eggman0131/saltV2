#!/usr/bin/env node
// Frees the given TCP ports by terminating whatever is LISTENing on them:
// SIGTERM first, then SIGKILL any survivors. Cross-platform via lsof (macOS and
// Linux); no `fuser` (Linux/WSL-only, no -k on BSD/macOS).
//
// Used as a pre-start step in dev tasks so a *restart* can always rebind its
// ports even if the previous run was stopped abruptly and orphaned a process
// (e.g. a task-runner "restart" button that signals only the top of the tree
// and leaves a deep child — like genkit's tsx/node leaf — holding a port).
//
// NOTE: this is a blunt kill with NO data export. It is only for stateless dev
// servers (vite, genkit). The Firebase emulators must NOT use this — they use
// scripts/stop-emulators.mjs, which preserves dev data via export-on-exit.

import { execSync } from 'child_process';

const ports = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0);

if (ports.length === 0) {
  console.log('free-ports: no ports given, nothing to do.');
  process.exit(0);
}

const SIGKILL_GRACE_MS = 5_000;
const POLL_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listeningPids(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    // lsof exits non-zero when nothing matches — port is free.
    return [];
  }
}

function occupiedPids() {
  return [...new Set(ports.flatMap(listeningPids))];
}

function kill(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone — best effort
    }
  }
}

const initial = occupiedPids();
if (initial.length === 0) {
  console.log(`free-ports: ports ${ports.join(', ')} already free.`);
  process.exit(0);
}

console.log(`free-ports: SIGTERM to PIDs ${initial.join(', ')} on ports ${ports.join(', ')}...`);
kill(initial, 'SIGTERM');

const deadline = Date.now() + SIGKILL_GRACE_MS;
while (Date.now() < deadline) {
  await sleep(POLL_MS);
  if (occupiedPids().length === 0) {
    console.log('free-ports: all ports free.');
    process.exit(0);
  }
}

const survivors = occupiedPids();
if (survivors.length > 0) {
  console.warn(`free-ports: SIGKILL to survivors ${survivors.join(', ')}...`);
  kill(survivors, 'SIGKILL');
  await sleep(500);
}

const stillBusy = occupiedPids();
if (stillBusy.length > 0) {
  console.error(
    `free-ports: PIDs ${stillBusy.join(', ')} still holding ports ${ports.join(', ')}.`,
  );
  process.exit(1);
}
console.log('free-ports: all ports free.');
process.exit(0);
