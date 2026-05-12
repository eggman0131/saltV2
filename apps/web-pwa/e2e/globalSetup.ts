import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-emulators.mjs');
const WATCHDOG_SCRIPT = path.join(REPO_ROOT, 'scripts/emulator-watchdog.mjs');
const WATCHDOG_PID_FILE = path.join(os.tmpdir(), 'salt-emulator-watchdog.pid');
const AUTH_URL = 'http://127.0.0.1:9099';
const FUNCTIONS_READY_URL = 'http://127.0.0.1:5001/demo-salt/europe-west2/matchOrCreateCanon';
const EMULATOR_PORTS = [4400, 8080, 9099, 5001, 5000, 9199];
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
      `globalSetup: emulator ports ${busy.join(', ')} still occupied after stop-emulators — refusing to run tests against pre-existing emulators (would risk dev data).`,
    );
  }
}

function stopEmulators(): void {
  try {
    execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
  } catch {
    // best effort: if the hub is already gone this is a no-op
  }
}

function killExistingWatchdog(): void {
  if (!fs.existsSync(WATCHDOG_PID_FILE)) return;
  try {
    const pid = Number(fs.readFileSync(WATCHDOG_PID_FILE, 'utf8').trim());
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  } catch {
    // unreadable PID file
  }
  try {
    fs.unlinkSync(WATCHDOG_PID_FILE);
  } catch {
    // already gone
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
  killExistingWatchdog();
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });

  // Defense-in-depth: never run tests against emulators we did not start.
  // If anything still listens on these ports, fail loudly instead of silently
  // using pre-existing dev emulators (would risk overwriting dev data).
  await assertEmulatorPortsFree();

  const emulatorLog = process.env.CI ? fs.openSync('/tmp/firebase-emulators.log', 'w') : null;
  spawn('firebase', ['emulators:start', '--project=demo-salt', '--only=auth,firestore,functions'], {
    cwd: REPO_ROOT,
    stdio: emulatorLog ? ['ignore', emulatorLog, emulatorLog] : 'pipe',
    detached: false,
  });

  // Detached watchdog: survives SIGKILL of this runner (which the VS Code
  // Playwright extension does between runs). Polls our PID; when we're gone,
  // it runs stop-emulators and exits. globalTeardown kills it in the happy path.
  const watchdog = spawn('node', [WATCHDOG_SCRIPT, String(process.pid)], {
    detached: true,
    stdio: 'ignore',
  });
  watchdog.unref();
  if (watchdog.pid) {
    fs.writeFileSync(WATCHDOG_PID_FILE, String(watchdog.pid), 'utf8');
  }

  // In-process safety net for clean exits without globalTeardown. SIGKILL is
  // covered by the watchdog above.
  process.once('exit', stopEmulators);

  await waitForEmulator();
  await waitForFunctions();
}
