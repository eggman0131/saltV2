// Vitest emulator integration orchestrator (issue #84, Phase 3).
//
// Runs the Vitest emulator integration suites against their OWN isolated
// composed stack (docker/test-emulators/docker-compose.vitest.yml), replacing
// the legacy root `test:emulator` that ran `scripts/stop-emulators.mjs` (the
// DEV stop path) then `firebase emulators:exec` against the DEV
// `firebase.json` ports — which killed a running `pnpm dev:emulators` and
// mutated dev data (issue #84 cause #3).
//
// This script never touches the dev emulator, dev data, or the e2e stack:
// the vitest stack is its own compose project on its own ports. A `down -v`
// before and a guaranteed `down -v` after give a deterministic clean slate
// and reap the whole process tree via the container boundary — no orphaned
// runtimes survive a run, and the stack is never left running (so it can
// never be concurrent with the e2e stack by accident).
//
// Readiness is the container healthcheck via `up --wait` — no host-side
// socket probe to a possibly-free port (the #79 WSL2 free-port contract).

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Relative paths inside the compose file resolve against the compose file's
// directory, so cwd is REPO_ROOT (same convention as the e2e harness).
const COMPOSE_FILE = 'docker/test-emulators/docker-compose.vitest.yml';

function compose(args) {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

// Sequential, stop-on-first-failure (mirrors the old `&&` chain). The Vitest
// stack ports are injected into both suites via their vitest.emulator.config
// `test.env` — no init.ts/auth.ts change.
function runSuites() {
  execFileSync('pnpm', ['--filter', '@salt/firebase-sync', 'test:emulator'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['--filter', '@salt/cloud-functions', 'test:emulator'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

// Clean slate: reap any poisoned vitest stack left by a previously aborted
// run before bringing a fresh one up.
compose(['down', '-v']);

let exitCode = 0;
try {
  compose(['up', '--wait']); // healthcheck-gated; returns only once healthy
  runSuites();
} catch (err) {
  exitCode = typeof err?.status === 'number' && err.status !== 0 ? err.status : 1;
} finally {
  // Always reap — even if `up --wait` timed out unhealthy or a suite failed.
  // The container boundary guarantees zero surviving emulator child processes.
  compose(['down', '-v']);
}

process.exit(exitCode);
