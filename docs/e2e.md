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
races a jar download), now under one shared name (`salt-test-emulators:local` locally — see
[Prebuilt image in CI](#prebuilt-image-in-ci)), and the **single** test emulator config, `firebase.test.docker.json` at the
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

**Reuse contract.** `:5174` is host-global and Playwright does not manage it, so a server answering
there could be a prior e2e Vite from a different checkout, branch or emulator env — or a foreign
process. Reuse therefore requires **both**:

1. **Identity match.** A host-global sentinel records the pid and an identity hash over
   `{gitSha, appDir, emulatorEnv, ports}`. Anything healthy on `:5174` whose identity does not
   match this run's — or whose recorded pid is dead — is killed and the port drained before a fresh
   spawn (`--strictPort` fails immediately if the port is still bound).
2. **A health probe that fetches a transformed module** (`/src/main.ts`), asserting a JS
   content-type — not `fetch('/')`. Vite serves `index.html` straight off disk even when its
   transform pipeline is dead, so the old `status < 500` check passed against a wedged server that
   could no longer compile a module. `globalSetup` then adopted it and **every** spec in the run
   failed at `waitForBridge`, reading exactly like "my change broke everything" (issue #560). The
   content-type assertion is what rejects Vite's SPA fallback, which would otherwise return
   `index.html` with a 200 for a path the server no longer has mounted.

The server got wedged in the first place because it was spawned `stdio: 'pipe'` with nothing ever
reading those pipes: Vite's output filled the ~64KB buffer and then blocked on write once the
parent shell went away and closed the read end. Local spawns now use `'ignore'` (the CI path
already wrote to a real file, and is the only path that reads the log). **Do not spawn the e2e Vite
with an unread `'pipe'`.**

The discriminator, if you ever see it again: `globalSetup` output says whether the run *spawned* a
fresh Vite or *reused an identity-matched pid*. Killing `:5174` before the run forces the spawn
path.

**Both test stacks are host singletons, and the guard refuses them in a worktree.** The `:5174`
sentinel above, the `test-emulators` and `salt-vitest-emulators` compose projects, and their fixed
host ports (8081/9100/5002/4402 and 8082/9101) are all host-global — there is exactly one of each
on this machine, which is why two stacks never run concurrently. Two agents running e2e from two
linked worktrees therefore do not merely queue: the identity mismatch in the reuse contract makes
each one kill and respawn the other's Vite, and a `down -v` wipes a stack out from under a run in
progress. Both surface as plausible-looking test reds rather than as an obvious conflict. So
`e2e`, `e2e:ui`, `e2e:coverage` and `test:emulator` are prefixed with `scripts/host-guard.mjs`
(issue #759), which refuses them outright in a linked worktree — before anything is killed or
wiped — and names `SALT_TAKE_HOST=1` as the deliberate override once Daniel has agreed. None of the
contracts on this page change; the guard only refuses earlier. See **Worktree rules** in
[CLAUDE.md](../CLAUDE.md) for the three positions (main tree, linked worktree, cloud VM).

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

### Coverage — opt-in, and deliberately not in CI (issue #945)

V8 coverage collection is **off unless `E2E_COVERAGE=1`**. It used to be an unconditional auto
fixture, so every CI shard paid for it and then binned the output — CI never ran the report and
never uploaded `coverage/e2e-raw/`. Rather than build a report nobody consumes (there is no e2e
coverage floor, and the route layer already carries a unit one), collection became opt-in:

```bash
pnpm --filter @salt/web-pwa e2e:coverage          # sets the flag, then writes HTML + LCOV
E2E_COVERAGE=1 pnpm --filter @salt/web-pwa e2e    # collect only; report later
pnpm --filter @salt/web-pwa e2e:coverage:report   # convert whatever is in coverage/e2e-raw/
```

Reports land in `apps/web-pwa/coverage/e2e/` (gitignored). Reasoning, and what to change if e2e
coverage ever gains a consumer, is in the comment at `e2e/fixtures/test.ts`.

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

CI runs the two stacks as **separate jobs** in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Neither is gated behind the cheap `ci`
aggregate job — both depend only on `changes`, the path-filter job. That gate was deliberately
removed; why, and why the `concurrency` block replaced it, is in the `vitest-integration` job
comment.

1. **`vitest-integration`** — runs `pnpm test:emulator` (the isolated Vitest stack). No host Java,
   no Cloud Functions prebuild, no Playwright (Firestore+Auth-only stack; `scripts/test-emulator.mjs`
   owns bring-up/teardown).
2. **`e2e`** — `globalSetup` builds the CF bundle, brings up the healthcheck-gated e2e stack, and
   spawns the `:5174` Vite server; `CI=true` makes `globalTeardown` run `docker compose … down -v`.
   No host Java / firebase-emulator cache / manual Vite step — the emulators are containerized
   (jars baked into the image).

The two run **concurrently in CI**, which is safe and not a violation of the issue #84
non-concurrency rule: that rule is a SINGLE-HOST constraint (local dev runs both stacks on one
machine). Each GitHub Actions job gets its own runner, so the stacks never share ports, volumes or
Docker state — and they are structurally isolated anyway (distinct compose project + ports
8082/9101 vs 8081/9100).

Both jobs carry a `timeout-minutes` bound. Without one a wedged `up --wait` or a stalled package
fetch sits on GitHub's 6-hour default: run 30087640130 burned 22+ minutes without reaching a single
test before anyone noticed (issue #580).

### Prebuilt image in CI

The Dockerfile fetches a Temurin JRE from `packages.adoptium.net` and `firebase-tools` + the
emulator jars from npm. Rebuilding it on every run put two third-party registries on the critical
path of every CI run — and on 2026-07-24 `apt-get install temurin-21-jre` failed outright (exit
100) and took the e2e job with it.

So the image is built **once per Dockerfile change** by
[`.github/workflows/emulator-image.yml`](../.github/workflows/emulator-image.yml) and published to
`ghcr.io/<owner>/salt-test-emulators`. The tag is a content hash of the build inputs:

```bash
cat docker/test-emulators/Dockerfile docker/test-emulators/healthcheck.sh | sha256sum | cut -c1-16
```

Both heavy jobs pull that exact tag via the [`emulator-image`](../.github/actions/emulator-image/action.yml)
composite action, which exports `SALT_EMULATOR_IMAGE`; the compose files resolve
`image: ${SALT_EMULATOR_IMAGE:-salt-test-emulators:local}` to it.

Two properties make this safe to trust:

- **Content-addressed** — a changed Dockerfile asks for a tag that does not exist yet, so CI can
  never silently run a stale published image against new build inputs.
- **Best-effort** — every miss (unpublished tag, fork PR that cannot read the package, GHCR down)
  falls through to `docker compose up` building the image locally, exactly as before. The pull is
  an optimisation, never a dependency.

A PR that edits the Dockerfile therefore builds locally (slower, correct); merging it republishes
the image and the next run pulls again.

Locally nothing changes: `SALT_EMULATOR_IMAGE` is unset, so both stacks share the
`salt-test-emulators:local` tag and `globalSetup`'s `.image-build-hash` marker still drives
rebuild-on-Dockerfile-change.

The e2e job additionally caches `~/.npm` and sets `npm_config_prefer_offline`, because
`globalSetup` builds the Cloud Functions deploy bundle with `npm install --prefix dist` (259
packages) on every run — an install that took 8 minutes instead of 11 seconds on the same bad
runner. The flag is scoped to that job on purpose: the deploy workflows must keep resolving version
ranges against the live registry.

There are no flaky `sleep`s anywhere in the gate — readiness is the container healthcheck
(`up --wait`), and teardown is the deterministic `down -v` (in `globalTeardown` for e2e, in a
`finally` for the Vitest orchestrator). The `e2e` job uploads three artifacts —
`playwright-report-shard-N`, `playwright-test-results-shard-N`, and `e2e-server-logs-shard-N`
(the emulator log captured by `globalTeardown` before `down -v`, the Vite server log, and the
shard's flake NDJSON) — on `failure() || <retry-recovered flakes detected>`, not `failure()` alone:
a shard that flaked but ended green used to leave nothing to download (14-day retention on all
three).

### Flake telemetry (issue #669)

Those artifacts are the *debugging* path, and they are `failure()`-only — which means the **flaky**
signal (failed once, passed on the retry) left no trace at all, and workflow logs expire after ~8
days. "Is the suite flakier than it was two weeks ago, and which tests?" was therefore
unanswerable by the time anyone asked. #668 was the proof: 128 retry-recovered flakes against 13
red jobs, and the flakes started ten days before the first red.

So every shard now also runs
[`e2e/reporter/flakeReporter.ts`](../apps/web-pwa/e2e/reporter/flakeReporter.ts) (CI only — see
`reporter:` in `playwright.config.ts`), which writes **one NDJSON record per test** to
`apps/web-pwa/e2e-flake-events.ndjson`, passes included. An `if: always()` step wraps that file in
a `/batch/` envelope with `jq` and `curl`s it to PostHog.

| Property | Why it is there |
| --- | --- |
| `status` | `passed` / `flaky` / `failed` / `skipped`, collapsed from `TestCase.outcome()` |
| `retries` | attempts − 1; a `flaky` record is `retries ≥ 1` by definition |
| `shard`, `shard_total` | #668's pattern was flakiness following shard **position**, not the test — invisible without this |
| `test_title`, `test_file`, `project` | the breakdown keys |
| `duration_ms`, `error` | deciding attempt's duration; first line of the failing attempt, de-coloured and capped at 300 chars |
| `failed_attempt_duration_ms` | duration of the attempt that actually FAILED (null when nothing failed) — `duration_ms` alone is the passing retry's time and can wildly understate a timeout |
| `failure_kind` | `test-timeout` / `assertion` / `error` — how it failed, not just that it did |
| `test_index`, `file_index` | position in the shard's run order (0-based) and the index of the test's file — flakes cluster at the start of a shard (the cold-server class) |
| `ms_into_shard` | wall-clock milliseconds from the shard's first test starting to this one starting — the axis the cold-server effect actually lives on |
| `error_fingerprint` | the error with volatile bits (ids, counts, timeouts, seeded emails) normalised out, so repeat occurrences group by cause |
| `ctx_*` | scalars a test contributed via a `flake-context` attachment (see below) — generic, namespaced, reporter knows nothing about the app |
| `branch`, `commit_sha`, `run_id`, `run_attempt` | which run to go and look at |
| `source: ci`, `$process_person_profile: false` | CI is not a person and must never mint a person profile |

**Authoring `ctx_*` correlation data.** A test can attach app-side state at the moment it failed —
promoted from artifact-only to queryable — via the helpers in
[`e2e/helpers/diagnostics.ts`](../apps/web-pwa/e2e/helpers/diagnostics.ts), which reduce the store
snapshot to flat scalars (counts and booleans only, never ids/names/free-form content — the same
scrubbing rule as error reporting) and attach them under the `flake-context` name that
`flakeReporter.ts` reads. These helpers are pure diagnostics: guarded end-to-end so a closed page,
a thrown getter, or a serialization failure can never turn a test failure into a different one, and
they never affect pass/fail outcome.

**The reporter imports no PostHog SDK, and must not.** `posthog-js` / `posthog-node` are confined
to `@salt/observability` (CLAUDE.md rule 11) and `web-pwa` cannot import
`@salt/observability/server` either (cross-runtime rule). Emitting capture-shaped JSON and POSTing
it with `curl` crosses no boundary. Do not "tidy" this into the adapter.

**Where it lands.** A **separate PostHog project** — `Salt CI` (238605), not the `Salt` product
project — so CI traffic can never distort product insights or funnels. The workflow reads its write
key from the repo variable `POSTHOG_CI_KEY` (already set; `gh variable set POSTHOG_CI_KEY` to
rotate) — a `phc_…` project key, public by design, like the ones already committed in
`apps/web-pwa/.env.*`. An unset variable is a **skip with a notice**, not a failure, so forks are
unaffected, and the whole step is `continue-on-error` because telemetry must never turn a green
suite red.

**What to look at.** The [`e2e reliability`](https://eu.posthog.com/project/238605/dashboard/867049)
dashboard: the weekly flaky trend by test (the early-warning chart), the 14-day top offenders split
by test and shard, and flake rate as `flaky ÷ ran`. A daily alert fires by email when any single
test exceeds 3 flakes in a rolling 7 days — it evaluates a SQL insight row-by-row (`any_row`),
because a breakdown trend cannot be alerted on per breakdown value.

### Quarantine (issue #721)

A test that is known to flake poisons the thing the suite is for. People learn that amber on _that_
test means "re-run", and once re-running is the habit, the **next** flake — a real one, in code that
just changed — arrives into a suite nobody believes and reads as more of the same. Quarantine buys
that belief back.

To quarantine a test, put `@quarantine` in its title:

```ts
test('detail page — change aisle @quarantine', async ({ page }) => {
```

Per **test**, not per file: `shopping-list-multi-list.spec.ts` has five tests and historically only
one of them rotted, so a file-level mechanism would take four healthy tests out of the gate to
sideline one bad one.

What then happens to it: the `chromium` and `mobile-touch` projects `grepInvert` the tag, so the
test leaves the gating run immediately. A `quarantine` project picks it up instead — same retries,
same reporters — and CI runs that project as a separate, `continue-on-error` step on shard 1. So a
quarantined test **still runs, still lands in PostHog** with the same `test_title` breakdown key
(see [Flake telemetry](#flake-telemetry-issue-669)) and `project: quarantine` to tell it apart, and
no longer decides whether the PR merges.

**Quarantine is not a fix, and not a parking space.** NF-G3 does not soften for a quarantined test:
it is a bug that is still owed a fix. Tag it, open (or link) an issue in the same breath, and let
the flake-rate chart tell you when the fix worked — then take the tag off. A tag with no issue
behind it is how a suite quietly shrinks.

Two things follow from the CI shape and are worth knowing before you tag something. The quarantine
step greps the specs first and no-ops when nothing is tagged, because a second Playwright
invocation re-runs `globalSetup` — and CI's `globalTeardown` has already done `down -v`, so that
means standing the whole emulator stack back up. And because the reporter overwrites its NDJSON,
the quarantine run is pointed at its own file (`E2E_FLAKE_NDJSON`) and appended to the gating run's,
so both reach PostHog from the one existing upload step.

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
