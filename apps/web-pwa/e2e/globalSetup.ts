import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The Phase 1 composed test emulator stack (issue #84). `up --wait` blocks
// until the container healthcheck passes — and that healthcheck encodes
// "Functions triggers registered" with the exact same OPTIONS/CORS probe the
// old host-side waitForFunctions used, so it is the drop-in replacement for
// the 120s registration poll on identical readiness semantics. `down -v`
// reaps the whole functions-runtime process tree via the container boundary
// (issue #84 causes #1 and #2). Relative paths inside the compose file
// resolve against the compose file's directory, so cwd is REPO_ROOT.
const COMPOSE_FILE = 'docker/test-emulators/docker-compose.test.yml';

const FIRESTORE_CLEAR_URL =
  'http://127.0.0.1:8081/emulator/v1/projects/demo-salt/databases/(default)/documents';
const AUTH_CLEAR_URL = 'http://127.0.0.1:9100/emulator/v1/projects/demo-salt/accounts';
const TIMEOUT_MS = 120_000;
const POLL_MS = 500;

// Dedicated e2e app server. Playwright does NOT manage it (its webServer probe
// raw-socket-connects and deadlocks on this WSL2 host's free-port blackhole,
// issue #79); globalSetup owns the lifecycle instead. The container boundary
// is emulators-only (decided on issue #84): Vite stays host-spawned here,
// bound explicitly to the test emulator ports so the e2e app never falls
// back to the dev emulators.
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_APP_HOST = '127.0.0.1';
const E2E_APP_PORT = 5174;
const E2E_APP_URL = `http://${E2E_APP_HOST}:${E2E_APP_PORT}`;
const TEST_EMULATOR_ENV = {
  VITE_EMULATOR_FIRESTORE_PORT: '8081',
  VITE_EMULATOR_AUTH_PORT: '9100',
  VITE_EMULATOR_FUNCTIONS_PORT: '5002',
};

function dockerCompose(args: string[]): void {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

// The Functions emulator loads apps/cloud-functions/dist/index.js from the
// read-only repo mount, so the bundle MUST exist before the stack comes up.
// Building it here every run is what removes the cold-compile-vs-trigger-
// registration race that produced the 120s timeout on a fresh WSL boot
// (issue #84 cause #1).
function buildCloudFunctions(): void {
  execFileSync('pnpm', ['--filter', '@salt/cloud-functions', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

async function wipeEmulatorData(): Promise<void> {
  const [firestoreRes, authRes] = await Promise.all([
    fetch(FIRESTORE_CLEAR_URL, { method: 'DELETE' }),
    fetch(AUTH_CLEAR_URL, { method: 'DELETE' }),
  ]);
  if (!firestoreRes.ok && firestoreRes.status !== 404) {
    throw new Error(`globalSetup: failed to clear Firestore emulator: HTTP ${firestoreRes.status}`);
  }
  if (!authRes.ok && authRes.status !== 404) {
    throw new Error(`globalSetup: failed to clear Auth emulator: HTTP ${authRes.status}`);
  }
}

// Every probe here is fetch + AbortSignal.timeout — never a raw socket connect.
// A connect to a possibly-free port hangs forever on this WSL2 host (issue #79);
// the timer-based abort bounds it regardless of whether anything is listening.
async function e2eServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(E2E_APP_URL, { signal: AbortSignal.timeout(2000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureE2eServer(): Promise<void> {
  // Reuse contract: anything healthy on :5174 is treated as our e2e server;
  // we do NOT verify it is env-wired to the test emulator ports. Accepted, not
  // hardened: the dev server lives on :5173 and nothing else binds :5174 on
  // this host, so in practice the only thing answering here is a prior e2e
  // vite with the same TEST_EMULATOR_ENV. Judged an unlikely failure mode
  // (issue #79); revisit if a non-e2e process ever contends for :5174.
  if (await e2eServerHealthy()) {
    console.log(`globalSetup: reused existing e2e app server at ${E2E_APP_URL}.`);
    return;
  }

  const viteLog = process.env.CI ? fs.openSync('/tmp/e2e-vite.log', 'w') : null;
  spawn(
    'pnpm',
    ['exec', 'vite', '--host', E2E_APP_HOST, '--port', String(E2E_APP_PORT), '--strictPort'],
    {
      cwd: APP_DIR,
      env: { ...process.env, ...TEST_EMULATOR_ENV },
      stdio: viteLog ? ['ignore', viteLog, viteLog] : 'pipe',
      detached: false,
    },
  );

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await e2eServerHealthy()) {
      console.log(`globalSetup: e2e app server ready at ${E2E_APP_URL} (test emulator ports).`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `e2e app server did not become ready at ${E2E_APP_URL} within ${TIMEOUT_MS / 1000}s`,
  );
}

export default async function globalSetup(): Promise<void> {
  const forceFresh = process.env.E2E_FRESH === '1';

  // E2E_FRESH=1 forces a clean stack: drop the container + scratch volume so
  // the next `up` rebuilds from a cold emulator. Without it, `up --wait` is
  // idempotent — a stack already healthy from a prior run is reused (local
  // ergonomics; teardown stays gated by CI / E2E_TEARDOWN in globalTeardown).
  if (forceFresh) {
    dockerCompose(['down', '-v']);
  }

  buildCloudFunctions();
  dockerCompose(['up', '--wait']);

  // `up --wait` returns once the healthcheck passes (triggers registered), but
  // a reused stack still carries the prior run's data — wipe unconditionally so
  // both the fresh and reused paths start every run from clean emulator state.
  await wipeEmulatorData();

  await ensureE2eServer();
}
