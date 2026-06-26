# E2E & emulator integration tests

Playwright specs live in [`apps/web-pwa/e2e/`](../apps/web-pwa/e2e/). Each test signs in through the
emulator (`window.__e2e.devSignIn`). Browser observability is gated off in the e2e build (the
PostHog key is left empty), so there is no session-replay tagging — the downloaded Playwright trace
is the debugging artifact. See issue #14 for the foundation rationale and locked decisions.

> **Writing or reviewing a spec?** The stability contract every test must satisfy — the
> pre-review gate for determinism, isolation, realtime/AI-trigger races, and timeouts — lives in
> [docs/e2e-test-spec.md](e2e-test-spec.md). This document covers the emulator/CI mechanics; that
> one covers the non-functional rules layered on top.

The emulator-backed test stacks are **containerized** (issue #84). Both the e2e (Playwright) stack
and the Vitest emulator-integration stack run as healthcheck-gated `docker compose` services with a
deterministic `down -v` teardown. This is what makes the suites reliable on this WSL2 host: the
container boundary reaps the Functions emulator's `functionsEmulatorRuntime` child tree that
port-scoped `fuser -k` used to orphan, and the healthcheck gate replaces the old 120s
trigger-registration poll. See the [poisoned-environment section](#spotting--clearing-a-poisoned-environment)
for the failure mode this prevents.

## The containerized test emulator stacks

There are **two** independent composed stacks. They use distinct compose projects, distinct host
ports, and distinct named volumes, and **by design never run concurrently**:

| Stack                | Compose file                                  | Compose project        | Scope                         |
| -------------------- | --------------------------------------------- | ---------------------- | ----------------------------- |
| e2e (Playwright)     | `docker/test-emulators/docker-compose.test.yml`   | `test-emulators`       | Firestore + Auth + Functions  |
| Vitest integration   | `docker/test-emulators/docker-compose.vitest.yml` | `salt-vitest-emulators`| Firestore + Auth only         |

Both reuse the single settled image (`docker/test-emulators/Dockerfile` — `node:22` + Temurin 21
JRE + pinned `firebase-tools`, with the Firestore/UI emulator jars baked in so a cold `up` never
races a jar download) and the **single** test emulator config, `firebase.test.docker.json` at the
repo root. There is no `firebase.test.json` anymore — it was deleted once nothing host-runs the
emulators (issue #84, Phase 2); `firebase.test.docker.json` is the single source of truth for the
test port set, with `host: 0.0.0.0` on each emulator so the mapped container ports are reachable
from the host.

### Port sets

Both test stacks use project ID `demo-salt`. Isolation is **structural** (separate containers /
compose projects) plus disjoint host ports — not project-ID-based — so existing `firestore.rules`
and any `demo-salt`-coded test paths work unchanged.

| Service     | Dev (`firebase.json`) | e2e stack (host) | Vitest stack (host) |
| ----------- | --------------------- | ---------------- | ------------------- |
| Firestore   | 8080                  | 8081             | 8082                |
| Auth        | 9099                  | 9100             | 9101                |
| Functions   | 5001                  | 5002             | — (not run)         |
| Emulator hub| 4400                  | 4402             | — (not mapped)      |
| App (Vite)  | 5173                  | 5174             | — (n/a)             |

The e2e container also runs Storage/Hosting/UI internally (they are in `firebase.test.docker.json`)
but those ports are **not** mapped to the host — the e2e suite only uses Firestore/Auth/Functions.
The Vitest stack is **Firestore + Auth only**: those suites never exercise the Functions emulator,
so that stack has zero Cloud-Functions-bundle-prebuild coupling and a Firestore+Auth-only
healthcheck.

## The dedicated e2e app server

The container boundary is **emulators-only**. The e2e suite runs the app on its own Vite server at
`http://127.0.0.1:5174` — host-spawned by `globalSetup.ts`, separate from the dev server on
`:5173`, and **not** containerized (neither is Playwright/Chromium). `globalSetup.ts` spawns it
with the test-emulator env wiring (`VITE_EMULATOR_FIRESTORE_PORT=8081`,
`VITE_EMULATOR_AUTH_PORT=9100`, `VITE_EMULATOR_FUNCTIONS_PORT=5002`) so the e2e app always talks
to the test emulators and never falls back to the dev emulators (8080/9099/5001).

**Playwright does not own the web server.** There is intentionally no `webServer` block in
`playwright.config.ts`: Playwright's readiness probe does a raw socket connect, which deadlocks on
this WSL2 host's free-port blackhole (a connect to a non-listening `127.0.0.1` port hangs with no
`ECONNREFUSED`). Instead, `globalSetup.ts`/`globalTeardown.ts` own the lifecycle, the emulator
readiness gate is the **Docker healthcheck** (`docker compose … up --wait` blocks until the
container is healthy), and every host-side readiness/reuse probe is `fetch` +
`AbortSignal.timeout(...)` (timer-bounded, immune to the blackhole). See issue #79 for the full
diagnosis. Do not re-introduce a Playwright `webServer` block, and do not add a raw socket probe
to a possibly-free port.

**Reuse contract (accepted gap).** `globalSetup` reuses any server that answers `status < 500` on
`:5174`; it does **not** verify the reused server is e2e-configured (env-wired to the test
emulators). This is deliberately accepted, not hardened: the dev server is on `:5173` and nothing
else binds `:5174` on this host, so in practice the only thing answering there is a prior e2e Vite
with the same env. Revisit (e.g. a sentinel/health route) only if a non-e2e process ever contends
for `:5174`.

## Lifecycle, reuse & teardown

`globalSetup.ts` builds the Cloud Functions bundle (`pnpm --filter @salt/cloud-functions build`)
**before** bring-up — so trigger registration never races a cold compile — then runs
`docker compose -f docker/test-emulators/docker-compose.test.yml up --wait`. `up --wait` returns
only once the container healthcheck passes, i.e. once Functions triggers are registered (the
healthcheck runs the same OPTIONS/CORS probe to `matchOrCreateCanon` the old 120s poll did, so it
is a drop-in replacement on identical readiness semantics — not merely "port open"). Emulator
data is wiped every run so reused and fresh runs both start clean.

- **Default (local):** the emulator stack and the `:5174` Vite server are left running between
  runs for speed. `up --wait` is natively idempotent, so the next run reuses the healthy stack.
- **`E2E_FRESH=1`:** forces `docker compose … down -v` first, then a cold `up --wait` — use this
  to guarantee a pristine stack.
- **`E2E_TEARDOWN=1` or `CI`:** `globalTeardown.ts` runs `docker compose … down -v` (reaping the
  whole container process tree, including the `functionsEmulatorRuntime` children) and
  port-scoped-stops the host `:5174` Vite. GitHub Actions sets `CI=true` automatically, so CI
  always tears down.

## Running locally

Docker is required (the emulators run in a container; the image builds on first `up`). The dev
stack is entirely independent and is never touched by either test stack.

```bash
# e2e — globalSetup owns the test emulator container AND the :5174 app server (matches CI)
pnpm --filter @salt/web-pwa e2e:install   # one-time: install chromium
pnpm --filter @salt/web-pwa e2e
```

```bash
# Vitest emulator integration suites — own isolated composed stack (ports 8082/9101)
pnpm test:emulator
```

The dev stack and either test stack can run simultaneously with no interference (disjoint host
ports, separate containers). The dev emulators do **not** need to be running for tests —
`globalSetup` / `scripts/test-emulator.mjs` manage the entire test stack themselves:

```bash
# Terminal 1 — optional dev work, entirely independent of the test stacks
pnpm dev:emulators                        # dev emulators on 8080/9099/5001 (optional)
pnpm --filter @salt/web-pwa dev           # dev Vite on :5173 (optional)

# Terminal 2 — e2e (auto-manages the test emulator container + the :5174 app server)
pnpm --filter @salt/web-pwa e2e
```

By default the e2e stack stays up between runs for speed. To tear it down after a run, set
`E2E_TEARDOWN=1`; to force a pristine stack, set `E2E_FRESH=1` (CI always tears down):

```bash
E2E_TEARDOWN=1 pnpm --filter @salt/web-pwa e2e   # down -v after the run
E2E_FRESH=1 pnpm --filter @salt/web-pwa e2e      # down -v first, then a cold up
```

`pnpm --filter @salt/web-pwa e2e:ui` opens Playwright's UI mode for interactive debugging.

## Vitest emulator integration suites

`pnpm test:emulator` runs `scripts/test-emulator.mjs`, which owns the full lifecycle of the
**isolated** Vitest stack (`docker-compose.vitest.yml`, project `salt-vitest-emulators`, host
ports 8082/9101): `down -v` (clean slate) → `up --wait` (healthcheck-gated) → run the
`@salt/firebase-sync` then `@salt/cloud-functions` emulator suites → **always `down -v`** in a
`finally`. The stack is never left running, so it can never be concurrent with the e2e stack by
accident.

This stack no longer runs `scripts/stop-emulators.mjs` and no longer uses the dev `firebase.json`
ports, so it never kills a running `pnpm dev:emulators` or mutates dev data (issue #84 cause #3).
The suites resolve their emulator host from env rather than a hardcoded `127.0.0.1:8080`:

- `@salt/firebase-sync` (client SDK path) reads `import.meta.env` populated by the committed
  [`packages/adapters/firebase-sync/.env.test`](../packages/adapters/firebase-sync/.env.test).
  This file is intentionally **committed** (`.gitignore` only excludes `.env`/`.env.local`/
  `.env.*.local`), so CI gets it on checkout — it is the only mechanism that retargets the client
  SDK without changing `init.ts`/`auth.ts` runtime defaults. Do not delete it.
- `@salt/cloud-functions` (Admin SDK path) reads `process.env` populated by
  `apps/cloud-functions/vitest.emulator.config.ts` `test.env`.

The Vitest port constant is therefore duplicated in three coupled places — `docker-compose.vitest.yml`
(authoritative), `firebase-sync/.env.test`, and `cloud-functions/vitest.emulator.config.ts` —
because three different consumers need it (Docker host mapping / `import.meta.env` / `process.env`).
Changing the ports means changing all three in lockstep.

## CI

CI runs the two stacks as **separate, sequenced jobs** in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — never concurrently (issue #84):

1. **`vitest-integration`** — runs `pnpm test:emulator` (the isolated Vitest stack). No host Java,
   no Cloud Functions prebuild, no Playwright (Firestore+Auth-only stack; `scripts/test-emulator.mjs`
   owns bring-up/teardown). It is the cheaper suite and runs first so it fails fast.
2. **`e2e`** — `needs: vitest-integration`, so it only starts once the Vitest stack job has
   finished (the two composed stacks are therefore never concurrent). `globalSetup` builds the CF
   bundle, brings up the healthcheck-gated e2e stack, and spawns the `:5174` Vite server; `CI=true`
   makes `globalTeardown` run `docker compose … down -v`. No host Java / firebase-emulator cache /
   manual Vite step — the emulators are containerized (jars baked into the image).

There are no flaky `sleep`s anywhere in the gate — readiness is the container healthcheck
(`up --wait`), and teardown is the deterministic `down -v` (in `globalTeardown` for e2e, in a
`finally` for the Vitest orchestrator). On failure the `e2e` job uploads the Playwright HTML
report and traces as `playwright-report` / `playwright-test-results` artifacts (14-day retention);
the downloaded Playwright trace is the CI debugging path.

## Spotting & clearing a poisoned environment

**This is what the container boundary fixes.** Historically (pre-#84) the e2e stop path was
port-scoped `fuser -k`: it freed the emulator ports but left the Functions emulator's
`functionsEmulatorRuntime` Node children alive and re-parented. Under kill/restart cycling these
orphans stacked up, contended with each new emulator, and produced **silent false reds** — e.g. a
clean `25/25 (1.3m)` run degrading to `24-failed/1-passed (8.0m)` with mass `toHaveURL` /
`toBeVisible` timeouts, with no signal that the cause was environmental rather than the branch
code. A lone Firestore JVM still holding the test Firestore port plus a portless orphaned
`firebase-functions` runtime is the canonical signature.

With the composed stacks this class of orphan is **structurally impossible**: `down -v` removes
the container, which reaps the entire child-process tree (the runtime children die with their
container), so no orphan can survive a teardown or be re-parented onto the host.

If you suspect a poisoned environment (test runs slow/flaky for no code reason):

```bash
# 1. Are there leftover test-stack containers or volumes?
docker ps -a --filter "name=salt-test-emulators" --filter "name=salt-vitest-emulators"
docker volume ls | grep -E 'emulator-work'

# 2. Are there orphaned emulator child processes on the HOST?
#    (Should be ZERO for the test stacks — they live in containers.)
pgrep -fa functionsEmulatorRuntime
pgrep -fa 'cloud-firestore-emulator|firebase.*emulators'

# 3. Deterministic clear of either test stack (safe — does not touch dev):
docker compose -f docker/test-emulators/docker-compose.test.yml down -v     # e2e stack
docker compose -f docker/test-emulators/docker-compose.vitest.yml down -v   # Vitest stack
```

`E2E_FRESH=1 pnpm --filter @salt/web-pwa e2e` does the e2e `down -v` + cold `up` for you. Any
host-side `functionsEmulatorRuntime` attributable to the **test** stacks after a teardown is a
bug — the test emulators never run on the host anymore. (The dev emulators, started by
`pnpm dev:emulators` on 8080/9099/5001, do still run on the host and are out of scope here — do
not kill them when clearing a test-stack poison.)

## Authoring conventions

- **Helpers** — `apps/web-pwa/e2e/helpers/` exposes functional helpers (`signIn`, `seedAisles`,
  `seedCanonItem`, locator factories). No page-object classes.
- **Locators** — accessible queries by default; `data-testid` is allowed on action elements (icon
  buttons, dialog containers, drag handles) but content assertions stay on roles/labels.
- **Isolation** — fresh browser context per test; per-test unique emails (`e2e-${testId}@salt.test`).
  Firestore is cleared once per file in `globalSetup`.
- **Seeding** — write through the existing `@salt/firebase-sync` adapter so tests exercise the
  real Firestore persistence code paths (Firestore is the live data layer; offline reads/writes
  go through its `persistentLocalCache`).
