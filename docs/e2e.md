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

Both stacks use project ID `demo-salt`. Isolation is by port, not project ID, so existing
`firestore.rules` and any `demo-salt`-coded test paths work unchanged.

`firebase.json` defines the dev port set. `firebase.test.json` at the repo root defines the test
port set and is used exclusively by `globalSetup.ts`.

## Running locally

```bash
# Playwright manages its own test emulators + Vite (matches CI exactly)
pnpm --filter @salt/web-pwa e2e:install   # one-time: install chromium
pnpm --filter @salt/web-pwa e2e
```

Because the test emulators run on a private port set, dev and e2e can run simultaneously with no
interference:

```bash
# Terminal 1 — dev stack (unchanged, unaffected)
pnpm dev:emulators

# Terminal 2 — optional: dev vite server
pnpm --filter @salt/web-pwa dev

# Terminal 3 — e2e (manages its own test emulators on test ports)
pnpm --filter @salt/web-pwa e2e
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
