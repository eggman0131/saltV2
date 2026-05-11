import { execFileSync, execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-emulators.mjs');
const AUTH_URL = 'http://127.0.0.1:9099';
const TIMEOUT_MS = 120_000;
const POLL_MS = 500;

// Synchronous cleanup — safe to call from a process.on('exit') handler.
function stopEmulators(): void {
  try {
    execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
  } catch {
    // best effort: if the hub is already gone this is a no-op
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

export default async function globalSetup(): Promise<void> {
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });

  spawn('firebase', ['emulators:start', '--project=demo-salt', '--only=auth,firestore,functions'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    detached: false,
  });

  // Safety net: stop test emulators when the Playwright process exits even if
  // globalTeardown is not called (VS Code extension keeps the runner alive
  // between runs and does not reliably invoke teardown after each run).
  process.once('exit', stopEmulators);

  await waitForEmulator();
}
