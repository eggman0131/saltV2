import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-test-emulators.mjs');
const HUB_URL = 'http://127.0.0.1:4402/emulators';
const AUTH_URL = 'http://127.0.0.1:9100';
const FUNCTIONS_READY_URL = 'http://127.0.0.1:5002/demo-salt/europe-west2/matchOrCreateCanon';
const FIRESTORE_CLEAR_URL =
  'http://127.0.0.1:8081/emulator/v1/projects/demo-salt/databases/(default)/documents';
const AUTH_CLEAR_URL = 'http://127.0.0.1:9100/emulator/v1/projects/demo-salt/accounts';
const EMULATOR_PORTS = [4402, 8081, 9100, 5002, 5003, 9200];
const TIMEOUT_MS = 120_000;
const POLL_MS = 500;

// Dedicated e2e app server. Playwright does NOT manage it (its webServer probe
// raw-socket-connects and deadlocks on this WSL2 host's free-port blackhole,
// issue #79); globalSetup owns the lifecycle instead. Bound explicitly to the
// test emulator ports so the e2e app never falls back to the dev emulators.
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_APP_HOST = '127.0.0.1';
const E2E_APP_PORT = 5174;
const E2E_APP_URL = `http://${E2E_APP_HOST}:${E2E_APP_PORT}`;
const TEST_EMULATOR_ENV = {
  VITE_EMULATOR_FIRESTORE_PORT: '8081',
  VITE_EMULATOR_AUTH_PORT: '9100',
  VITE_EMULATOR_FUNCTIONS_PORT: '5002',
};

interface HubEmulatorInfo {
  name: string;
  host: string;
  port: number;
}

const EXPECTED_EMULATORS: Record<string, number> = {
  auth: 9100,
  firestore: 8081,
  functions: 5002,
  hub: 4402,
};

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function assertEmulatorPortsFree(): Promise<void> {
  const checks = await Promise.all(
    EMULATOR_PORTS.map(async (p) => ({ p, free: await portIsFree(p) })),
  );
  const busy = checks.filter((x) => !x.free).map((x) => x.p);
  if (busy.length > 0) {
    throw new Error(
      `globalSetup: test emulator ports ${busy.join(', ')} still occupied after stop attempt — a prior test run may have crashed; check for orphaned processes.`,
    );
  }
}

async function getRunningEmulators(): Promise<HubEmulatorInfo[] | null> {
  try {
    const res = await fetch(HUB_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, { host: string; port: number }>;
    return Object.entries(body).map(([name, info]) => ({ name, host: info.host, port: info.port }));
  } catch {
    return null;
  }
}

function emulatorsMatchExpected(running: HubEmulatorInfo[]): boolean {
  for (const [name, expectedPort] of Object.entries(EXPECTED_EMULATORS)) {
    const match = running.find((e) => e.name === name);
    if (!match || match.port !== expectedPort) return false;
  }
  return true;
}

async function waitForEmulator(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(AUTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Emulators did not become ready within ${TIMEOUT_MS / 1000}s`);
}

async function waitForFunctions(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // OPTIONS preflight returns CORS headers once the function is registered;
      // a 404/connection-refused means the emulator is still loading.
      const res = await fetch(FUNCTIONS_READY_URL, {
        method: 'OPTIONS',
        headers: { Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'POST' },
        signal: AbortSignal.timeout(2000),
      });
      if (res.headers.get('access-control-allow-origin')) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Functions emulator did not register triggers within ${TIMEOUT_MS / 1000}s`);
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

async function startEmulators(): Promise<void> {
  // Clean up any leftovers from a prior crashed test run before asserting ports are free.
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });

  // If stop-test-emulators couldn't clear a port (e.g. orphaned JVM from a hard crash),
  // fail loudly rather than starting tests against stale state.
  await assertEmulatorPortsFree();

  const emulatorLog = process.env.CI ? fs.openSync('/tmp/firebase-emulators.log', 'w') : null;
  spawn(
    'firebase',
    [
      'emulators:start',
      '--config',
      'firebase.test.json',
      '--project=demo-salt',
      '--only=auth,firestore,functions',
    ],
    {
      cwd: REPO_ROOT,
      stdio: emulatorLog ? ['ignore', emulatorLog, emulatorLog] : 'pipe',
      detached: false,
    },
  );

  await waitForEmulator();
  await waitForFunctions();
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

  let reusedEmulators = false;
  if (!forceFresh) {
    const running = await getRunningEmulators();
    if (running && emulatorsMatchExpected(running)) {
      try {
        // Confirm functions are still healthy — emulator process can be alive while triggers
        // are not registered (e.g. user edited CF source and build is in-flight).
        await waitForFunctions();
        await wipeEmulatorData();
        console.log(
          'globalSetup: reused existing test emulators (set E2E_FRESH=1 to force restart).',
        );
        reusedEmulators = true;
      } catch (err) {
        console.warn(
          `globalSetup: existing emulators failed readiness check (${(err as Error).message}); restarting...`,
        );
      }
    }
  }

  if (!reusedEmulators) {
    await startEmulators();
  }

  await ensureE2eServer();
}
