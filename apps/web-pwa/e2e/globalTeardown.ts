import { execFileSync, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STOP_SCRIPT = path.join(REPO_ROOT, 'scripts/stop-test-emulators.mjs');

// Must mirror E2E_APP_PORT in globalSetup.ts. globalSetup deliberately does not
// track the spawned vite process (no pid file, no retained handle — issue #79),
// so the dedicated e2e app server is stopped port-scoped here, under the same
// gate as the emulators.
const E2E_APP_PORT = 5174;

// Best-effort, port-scoped kill — mirrors stop-test-emulators.mjs's fuser usage.
// Never throws: fuser may be absent or nothing may hold the port, and a failed
// teardown kill must not mask the test run's result.
function killE2eServer(signal: 'TERM' | 'KILL'): void {
  try {
    execSync(`fuser -k -${signal} ${E2E_APP_PORT}/tcp 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // fuser unavailable or no process on the port — best effort.
  }
}

export default async function globalTeardown(): Promise<void> {
  const shouldTeardown = process.env.CI || process.env.E2E_TEARDOWN === '1';
  if (!shouldTeardown) {
    console.log(
      'globalTeardown: leaving test emulators + e2e app server running for faster subsequent runs (set E2E_TEARDOWN=1 or CI=1 to stop them).',
    );
    return;
  }
  // Stop the e2e app server (graceful, then force) before the emulators it talks to.
  killE2eServer('TERM');
  await new Promise((r) => setTimeout(r, 1000));
  killE2eServer('KILL');
  execFileSync('node', [STOP_SCRIPT], { stdio: 'inherit' });
}
