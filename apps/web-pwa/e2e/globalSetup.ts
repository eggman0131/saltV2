import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeIdentity,
  deleteSentinel,
  gitShaOf,
  killPort,
  pidAlive,
  readSentinel,
  waitForPortFree,
  writeSentinel,
} from './e2eServerRegistry';
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
  // Gate browser observability (PostHog) OFF under e2e: an empty key makes the
  // app's `if (_phKey)` guard in src/lib/observability.ts falsy, so posthog.init
  // is never called. Vite prioritizes an env var already in process.env over
  // .env.development, so this empty string wins. This removes any telemetry
  // capture from automated runs without touching app code. Prod/staging
  // observability init is unaffected.
  VITE_PUBLIC_POSTHOG_KEY: '',
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
//
// The probe fetches a TRANSFORMED MODULE, not `/` (issue #560). Vite serves
// index.html straight off disk even when its transform pipeline is dead, so a
// `fetch('/') < 500` check passes against a wedged server that can no longer
// compile a single module — and `ensureE2eServer` then ADOPTS it, after which
// every spec in the run fails at `waitForBridge` and reads exactly like "my change
// broke everything". Requesting the app's entry module makes the transform
// pipeline part of the health contract: a wedged server 500s (or times out) here.
// The content-type assertion is what rejects Vite's SPA fallback — an unknown path
// returns index.html as `text/html` with a 200, which would otherwise read as
// healthy on a server that no longer has the app mounted at all.
const E2E_APP_PROBE_URL = `${E2E_APP_URL}/src/main.ts`;
async function e2eServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(E2E_APP_PROBE_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    // Vite labels transformed modules `text/javascript` (some versions
    // `application/javascript`); either way the substring is the discriminator.
    if (!(res.headers.get('content-type') ?? '').includes('javascript')) return false;
    // Drain the body so the socket is released rather than left half-read for the
    // duration of the run's keep-alive — this probe runs on a 500ms poll loop.
    await res.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

// The identity of the e2e server THIS run would spawn. A healthy :5174 is only
// reused when its recorded identity matches — a server rooted at a different
// checkout (appDir), built from a different commit (gitSha), or wired to
// different emulator ports / a non-empty PostHog key (emulatorEnv) hashes
// differently and is treated as stale/foreign. gitSha is best-effort (empty on
// a missing .git — never throws).
function currentServerIdentity(): string {
  return computeIdentity({
    gitSha: gitShaOf(APP_DIR),
    appDir: APP_DIR,
    emulatorEnv: TEST_EMULATOR_ENV,
    ports: [E2E_APP_PORT],
  });
}

// Spawn a fresh e2e Vite server, record its identity in the host-global
// sentinel, and poll until it answers. The child's pid is captured and persisted
// so a later run can identity-verify reuse and teardown can kill it precisely.
//
// stdio is 'ignore', never 'pipe' (issue #560). The server outlives this process
// by design — Playwright does not manage it and the next run may reuse it — but
// nothing ever attached a reader to those pipes, so Vite's output went nowhere,
// filled the ~64KB pipe buffer, and then blocked on write the moment the parent
// shell went away and closed the read end. That is how a server ends up listening
// on :5174 while unable to transform a module. /dev/null has no such ceiling and
// survives the parent's death. The CI path already wrote to a real file for the
// same reason, and keeps doing so — it is the only path where the log is read.
async function spawnE2eServer(identity: string): Promise<void> {
  const viteLog = process.env.CI ? fs.openSync('/tmp/e2e-vite.log', 'w') : null;
  const child = spawn(
    'pnpm',
    ['exec', 'vite', '--host', E2E_APP_HOST, '--port', String(E2E_APP_PORT), '--strictPort'],
    {
      cwd: APP_DIR,
      env: { ...process.env, ...TEST_EMULATOR_ENV },
      stdio: viteLog ? ['ignore', viteLog, viteLog] : ['ignore', 'ignore', 'ignore'],
      detached: false,
    },
  );
  if (typeof child.pid === 'number') {
    writeSentinel({
      pid: child.pid,
      identity,
      port: E2E_APP_PORT,
      createdAt: new Date().toISOString(),
    });
  }

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

// Compile every app component before the first test navigates (issue #668).
//
// A dev server transforms modules on demand, so the first navigation to a route
// pays vite-plugin-svelte's compile for that route AND everything it imports.
// Unsharded that cost was paid once, by the first spec of the whole run; #587's
// 3-way shard made three cold servers each pay it, on whichever spec happens to
// sort first in their slice — which is precisely the set of tests that flake
// (aisles-seed, issue-16-canon-create-detail, recipe-shopping-list, and
// equipment-capture while it still led shard 2). Requesting the modules here
// moves that work off the first test's 10s expect budget.
//
// One level, not a crawl: the transform cost lives in the .svelte compiles, and
// requesting each file compiles it regardless of who imports it. The
// dep-optimizer half of the same cold-start problem is handled config-side by
// optimizeDeps.include (apps/web-pwa/vite.config.ts) — read that comment before
// changing either; on their own neither one closes the window.
//
// Best-effort by construction: a module that fails to transform leaves exactly
// one component cold, which is the status quo this improves on. Failing the run
// here would turn a warm-up into a new way for CI to go red before a single
// test has run.
async function warmE2eServer(): Promise<void> {
  const modules = fs
    .globSync('src/**/*.svelte', { cwd: APP_DIR })
    // Deliberate layer-violation fixtures — linted, never rendered (see
    // .boundary-tests/run.sh). Nothing under test imports them.
    .filter((rel) => !rel.includes('__boundary_tests__'));
  const startedAt = Date.now();
  await Promise.all(
    modules.map(async (rel) => {
      try {
        const res = await fetch(`${E2E_APP_URL}/${rel.split(path.sep).join('/')}`, {
          signal: AbortSignal.timeout(30_000),
        });
        // Drain so the socket is released rather than held open for the run.
        await res.arrayBuffer();
      } catch {
        // See above: a cold component is not a reason to fail the suite.
      }
    }),
  );
  console.log(
    `globalSetup: warmed ${modules.length} components in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
  );
}

async function ensureE2eServer(): Promise<void> {
  // Reuse contract (hardened, issue #79 fallout): :5174 is HOST-GLOBAL and
  // Playwright does not manage it, so a healthy server here could be a prior
  // e2e vite from a DIFFERENT checkout / branch / emulator-env — or a foreign
  // process entirely. We now identity-verify against a host-global sentinel
  // before reuse: reuse ONLY a live server whose recorded identity matches this
  // run's. Anything else healthy on :5174 is killed (cross-platform) and the
  // port drained before we spawn fresh, because --strictPort fails immediately
  // if the port is still bound.
  const identity = currentServerIdentity();
  const sentinel = readSentinel();

  if (await e2eServerHealthy()) {
    if (sentinel && sentinel.identity === identity && pidAlive(sentinel.pid)) {
      console.log(
        `globalSetup: reusing identity-matched e2e server at ${E2E_APP_URL} (pid ${sentinel.pid}).`,
      );
      return;
    }
    // Healthy but stale / wrong-branch / wrong-env / foreign — replace it.
    console.log(
      `globalSetup: replacing stale/foreign :5174 server (identity mismatch or dead sentinel) before spawning fresh.`,
    );
    killPort(E2E_APP_PORT, 'SIGTERM', sentinel?.pid);
    await new Promise((r) => setTimeout(r, 1000));
    killPort(E2E_APP_PORT, 'SIGKILL', sentinel?.pid);
    deleteSentinel();
    if (!(await waitForPortFree(E2E_APP_PORT))) {
      throw new Error(
        `globalSetup: :5174 still bound after killing the stale server; cannot spawn a fresh e2e app server (--strictPort).`,
      );
    }
  } else if (sentinel) {
    // Nothing healthy on :5174 but a stale sentinel lingers — best-effort clean
    // up any leftover pid/entry before spawning fresh.
    killPort(E2E_APP_PORT, 'SIGKILL', sentinel.pid);
    deleteSentinel();
  }

  console.log(`globalSetup: spawning fresh e2e server at ${E2E_APP_URL}.`);
  await spawnE2eServer(identity);
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
  await warmE2eServer();
}
