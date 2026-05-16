# E2E tests

Playwright specs live in [`apps/web-pwa/e2e/`](../apps/web-pwa/e2e/). Each test signs in through the
emulator (`window.__e2e.devSignIn`), tags the LaunchDarkly Observability session, and attaches the
session-replay URL to the test result. See issue #14 for the foundation rationale and locked
decisions.

## Emulator port sets

E2E tests run their own Firebase emulator stack on a private port set that does not overlap with
the dev emulator or the Genkit dev UI:

| Emulator   | Dev port | Test port |
| ---------- | -------- | --------- |
| Firestore  | 8080     | 8081      |
| Auth       | 9099     | 9100      |
| Functions  | 5001     | 5002      |
| Storage    | 9199     | 9200      |
| Hosting    | 5000     | 5003      |
| Hub        | 4400     | 4402      |
| UI         | 4000     | 4002      |
| App (Vite) | 5173     | 5174      |

Both stacks use project ID `demo-salt`. Isolation is by port, not project ID, so existing
`firestore.rules` and any `demo-salt`-coded test paths work unchanged.

`firebase.json` defines the dev port set. `firebase.test.json` at the repo root defines the test
port set and is used exclusively by `globalSetup.ts`.

## The dedicated e2e app server

The e2e suite runs the app on its own Vite server at `http://127.0.0.1:5174` — separate from the
dev server on `:5173`. `globalSetup.ts` spawns it with the test-emulator env wiring
(`VITE_EMULATOR_FIRESTORE_PORT=8081`, `VITE_EMULATOR_AUTH_PORT=9100`,
`VITE_EMULATOR_FUNCTIONS_PORT=5002`) so the e2e app always talks to the test emulators and never
falls back to the dev emulators (8080/9099/5001).

**Playwright does not own the web server.** There is intentionally no `webServer` block in
`playwright.config.ts`: Playwright's readiness probe does a raw socket connect, which deadlocks on
this WSL2 host's free-port blackhole (a connect to a non-listening `127.0.0.1` port hangs with no
`ECONNREFUSED`). Instead, `globalSetup.ts`/`globalTeardown.ts` own the lifecycle, and every
readiness/reuse probe is `fetch` + `AbortSignal.timeout(...)` (timer-bounded, immune to the
blackhole). See issue #79 for the full diagnosis. Do not re-introduce a Playwright `webServer`
block.

**Reuse contract (accepted gap).** `globalSetup` reuses any server that answers `status < 500` on
`:5174`; it does **not** verify the reused server is e2e-configured (env-wired to the test
emulators). This is deliberately accepted, not hardened: the dev server is on `:5173` and nothing
else binds `:5174` on this host, so in practice the only thing answering there is a prior e2e Vite
with the same env. Revisit (e.g. a sentinel/health route) only if a non-e2e process ever contends
for `:5174`.

**Teardown gate.** Mirroring the emulators, the e2e server is left running by default so
subsequent local runs are fast. It is stopped (port-scoped, best-effort) only when `E2E_TEARDOWN=1`
or `CI=1` is set.

## Running locally

```bash
# globalSetup owns the test emulators AND the e2e app server on :5174 (matches CI)
pnpm --filter @salt/web-pwa e2e:install   # one-time: install chromium
pnpm --filter @salt/web-pwa e2e
```

Because the test emulators and the e2e app server use a private port set, the dev stack and e2e
can run simultaneously with no interference. The dev emulators do **not** need to be running for
e2e — `globalSetup` manages the entire test stack itself:

```bash
# Terminal 1 — optional dev work, entirely independent of e2e
pnpm dev:emulators                        # dev emulators on 8080/9099/5001 (optional)
pnpm --filter @salt/web-pwa dev           # dev Vite on :5173 (optional)

# Terminal 2 — e2e (auto-manages test emulators + the e2e app server on :5174)
pnpm --filter @salt/web-pwa e2e
```

By default both stacks stay up between runs for speed. To tear the test stack down after a run,
set `E2E_TEARDOWN=1` (CI always tears down):

```bash
E2E_TEARDOWN=1 pnpm --filter @salt/web-pwa e2e
```

`pnpm --filter @salt/web-pwa e2e:ui` opens Playwright's UI mode for interactive debugging.

## CI

The suite runs on every PR via the `e2e` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
On failure:

- Playwright HTML reports and traces upload as `playwright-report` / `playwright-test-results`
  artifacts (14-day retention).
- `LD replay: <url>` lines in the job log link directly to the matching LaunchDarkly session-replay.

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
