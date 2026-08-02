import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deleteSentinel, killPort, readSentinel } from './e2eServerRegistry';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Where the emulator's own logs land so CI can upload them. Beside
// e2e-flake-events.ndjson at the app root, gitignored, same as that file.
const EMULATOR_LOG_PATH = path.join(APP_DIR, 'e2e-emulator.log');

// Must mirror COMPOSE_FILE in globalSetup.ts. The composed test emulator stack
// (issue #84): `down -v` reaps the whole functions-runtime process tree via
// the container boundary, replacing the port-scoped `fuser -k` that orphaned
// runtimes (issue #84 cause #2). Relative paths in the compose file resolve
// against its directory, so cwd is REPO_ROOT.
const COMPOSE_FILE = 'docker/test-emulators/docker-compose.test.yml';

// Must mirror E2E_APP_PORT in globalSetup.ts. The e2e Vite server stays
// host-spawned (the container boundary is emulators-only, issue #84). It is now
// tracked via a host-global sentinel (e2eServerRegistry.ts) written at spawn, so
// teardown can kill it precisely (tracked pid) and portably here, under the same
// gate as the emulator stack.
const E2E_APP_PORT = 5174;

// Best-effort kill of the host-spawned e2e Vite server. Cross-platform (macOS +
// Linux) via lsof + process.kill — replaces the `fuser -k` that was a silent
// no-op on macOS and leaked servers across sessions. Targets the tracked
// sentinel pid first (precise), then any lsof-discovered :5174 listener. Never
// throws: nothing may hold the port, and a failed teardown kill must not mask
// the test run's result.
function killE2eServer(signal: 'SIGTERM' | 'SIGKILL'): void {
  const sentinel = readSentinel();
  killPort(E2E_APP_PORT, signal, sentinel?.pid);
}

// Dump the emulator container's logs to a file BEFORE `down -v` destroys it.
//
// This is the only moment they exist. Nothing else in the pipeline ever reads
// the container, and the `down -v` below takes the logs with it — so an
// emulator-side cause of a CI flake (a hung trigger, a starved functions
// worker, a Listen-channel reset) is currently invisible in the artifacts.
// Every uploaded artifact today is browser-side, which is why a flake whose
// symptom is "the app just did nothing" cannot be diagnosed at all.
//
// Best-effort by construction (Rule 10 in spirit): docker missing, the stack
// already gone, a write failure — none of them may fail teardown, because
// losing a diagnostic must never turn a green run red or mask a real result.
// maxBuffer is generous: a full 3-shard run's functions logs are chatty and the
// default 1 MB truncates them exactly when a run is interesting.
function captureEmulatorLogs(): void {
  try {
    const logs = execFileSync(
      'docker',
      ['compose', '-f', COMPOSE_FILE, 'logs', '--no-color', '--timestamps'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    fs.writeFileSync(EMULATOR_LOG_PATH, logs);
    console.log(`globalTeardown: wrote emulator logs to ${EMULATOR_LOG_PATH}.`);
  } catch (err) {
    console.warn(
      `globalTeardown: could not capture emulator logs (continuing): ${(err as Error)?.message ?? err}`,
    );
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
  // it talks to, then clear the host-global sentinel so a later run does not
  // try to reuse a now-dead pid.
  killE2eServer('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  killE2eServer('SIGKILL');
  deleteSentinel();
  // Must precede `down -v` — see captureEmulatorLogs.
  captureEmulatorLogs();
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
