import { execFileSync, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Must mirror COMPOSE_FILE in globalSetup.ts. The composed test emulator stack
// (issue #84): `down -v` reaps the whole functions-runtime process tree via
// the container boundary, replacing the port-scoped `fuser -k` that orphaned
// runtimes (issue #84 cause #2). Relative paths in the compose file resolve
// against its directory, so cwd is REPO_ROOT.
const COMPOSE_FILE = 'docker/test-emulators/docker-compose.test.yml';

// Must mirror E2E_APP_PORT in globalSetup.ts. The e2e Vite server stays
// host-spawned (the container boundary is emulators-only, issue #84), and
// globalSetup deliberately does not track the spawned vite process (no pid
// file, no retained handle — issue #79), so it is stopped port-scoped here,
// under the same gate as the emulator stack.
const E2E_APP_PORT = 5174;

// Best-effort, port-scoped kill of the host-spawned e2e Vite server. Never
// throws: fuser may be absent or nothing may hold the port, and a failed
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
      'globalTeardown: leaving the composed test emulator stack + e2e app server running for faster subsequent runs (set E2E_TEARDOWN=1 or CI=1 to stop them).',
    );
    return;
  }
  // Stop the e2e app server (graceful, then force) before the emulator stack
  // it talks to.
  killE2eServer('TERM');
  await new Promise((r) => setTimeout(r, 1000));
  killE2eServer('KILL');
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
