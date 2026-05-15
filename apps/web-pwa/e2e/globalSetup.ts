import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-test-emulators.mjs');
const AUTH_URL = 'http://127.0.0.1:9100';
const FUNCTIONS_READY_URL = 'http://127.0.0.1:5002/demo-salt/europe-west2/matchOrCreateCanon';
const EMULATOR_PORTS = [4402, 8081, 9100, 5002, 5003, 9200];
const TIMEOUT_MS = 120_000;
const POLL_MS = 500;

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
        headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST' },
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

export default async function globalSetup(): Promise<void> {
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
