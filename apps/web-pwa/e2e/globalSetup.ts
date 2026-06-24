import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FIRESTORE_EMULATOR_CLEAR_URL, FIRESTORE_EMULATOR_PORT_STRING } from './helpers/emulator';

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

const FIRESTORE_CLEAR_URL = FIRESTORE_EMULATOR_CLEAR_URL;
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
  VITE_EMULATOR_FIRESTORE_PORT: FIRESTORE_EMULATOR_PORT_STRING,
  VITE_EMULATOR_AUTH_PORT: '9100',
  VITE_EMULATOR_FUNCTIONS_PORT: '5002',
  // Gate LaunchDarkly OFF under e2e: an empty client-side id makes the app's
  // `if (_ldKey)` guard in src/lib/observability.ts falsy, so no LD client is
  // created. Vite prioritizes an env var already in process.env over
  // .env.development, so this empty string wins. LD session-replay is a no-op
  // under emulators (manualStart, never started), so this removes the dead LD
  // client without touching app code. Prod/staging LD init is unaffected.
  VITE_LD_CLIENT_SIDE_ID: '',
};

function dockerCompose(args: string[]): void {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

// Container name from docker-compose.test.yml (`container_name:`).
const CONTAINER_NAME = 'salt-test-emulators';
// Image build inputs, relative to the compose file's directory. A change to
// either is baked into the image only by a rebuild.
const IMAGE_BUILD_INPUTS = ['Dockerfile', 'healthcheck.sh'] as const;
// Records the content hash of the inputs the running image was built from, so a
// later run can tell whether the image is still current. Gitignored.
const IMAGE_HASH_MARKER = path.join(REPO_ROOT, path.dirname(COMPOSE_FILE), '.image-build-hash');

function dockerInspect(args: string[]): string | null {
  try {
    return execFileSync('docker', args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// A content hash (not mtime) of the image build inputs. Content-based so a bare
// `git checkout`/`pull` — which bumps file mtimes without changing bytes —
// never triggers a spurious rebuild, and so the marker converges: a cache-hit
// rebuild reproduces the same hash. mtime / image-`Created` comparisons do NOT
// converge (a fully-cached rebuild keeps the original image timestamp).
function imageBuildInputsHash(): string {
  const buildDir = path.join(REPO_ROOT, path.dirname(COMPOSE_FILE));
  const h = createHash('sha256');
  for (const f of IMAGE_BUILD_INPUTS) h.update(fs.readFileSync(path.join(buildDir, f)));
  return h.digest('hex');
}

// `docker compose up` reuses an existing image and never rebuilds it on a
// Dockerfile change, so a base-image / firebase-tools bump (e.g. #247, which
// pinned firebase-tools to 15.21) can silently leave an OLD emulator toolchain
// running in a long-lived dev container — surfacing as wedged Functions workers
// and callables that fail with ERR_CONNECTION_REFUSED, while CI (which always
// builds fresh) stays green. Detect it by comparing the build inputs' current
// hash to the marker recorded at the last rebuild, and force a from-scratch
// rebuild when they diverge. Best-effort: any docker/fs hiccup returns false so
// a detection problem never blocks the suite.
function emulatorImageIsStale(): boolean {
  // Only meaningful once an image/container exists; with none, `up` builds the
  // image fresh and recordImageBuildInputs() writes the marker afterwards.
  if (!dockerInspect(['inspect', CONTAINER_NAME, '--format', '{{.Id}}'])) return false;
  let recorded: string | null = null;
  try {
    recorded = fs.readFileSync(IMAGE_HASH_MARKER, 'utf8').trim();
  } catch {
    recorded = null;
  }
  // A missing marker means the image predates this check (or was built by an
  // out-of-band `up`): rebuild once so the container lands on the current
  // Dockerfile, after which the marker converges and the fast path resumes.
  return recorded !== imageBuildInputsHash();
}

// Asserts "the now-running image corresponds to the current build inputs".
// Called after every successful `up`, so the marker converges on the first run.
function recordImageBuildInputs(): void {
  try {
    fs.writeFileSync(IMAGE_HASH_MARKER, imageBuildInputsHash());
  } catch {
    // best-effort: a write failure just means the next run re-checks
  }
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
  const stale = emulatorImageIsStale();
  if (stale) {
    console.log(
      'globalSetup: emulator image predates its Dockerfile — rebuilding the stack from scratch ' +
        '(picks up base-image / firebase-tools changes a plain `up` would skip).',
    );
  }
  // E2E_FRESH=1 (manual) or a stale image (auto) forces a clean stack: drop the
  // container + scratch volume and rebuild the image, so the next `up` comes up
  // on the current toolchain from a cold emulator. Without it, `up --wait` is
  // idempotent — a stack already healthy from a prior run is reused (local
  // ergonomics; teardown stays gated by CI / E2E_TEARDOWN in globalTeardown).
  const forceFresh = process.env.E2E_FRESH === '1' || stale;
  if (forceFresh) {
    dockerCompose(['down', '-v']);
  }

  buildCloudFunctions();
  // `--build` only on the fresh path: it rebuilds the image (cache-fast when
  // the Dockerfile is unchanged) so a stale-detected or E2E_FRESH run actually
  // picks up the new Dockerfile. The reuse path stays a plain `up --wait` to
  // keep rapid local iteration free of a per-run build-cache check.
  dockerCompose(forceFresh ? ['up', '--wait', '--build'] : ['up', '--wait']);
  // Record the inputs the now-running image was built from so the next run's
  // staleness check converges (and the fast path resumes until they change).
  recordImageBuildInputs();

  // `up --wait` returns once the healthcheck passes (triggers registered), but
  // a reused stack still carries the prior run's data — wipe unconditionally so
  // both the fresh and reused paths start every run from clean emulator state.
  await wipeEmulatorData();

  await ensureE2eServer();
}
