# E2E tests

Playwright specs live in [`apps/web-pwa/e2e/`](../apps/web-pwa/e2e/). Each test signs in through the
emulator (`window.__e2e.devSignIn`), tags the LaunchDarkly Observability session, and attaches the
session-replay URL to the test result. See issue #14 for the foundation rationale and locked
decisions.

## Running locally

```bash
# Playwright manages its own emulators + Vite (matches CI)
pnpm --filter @salt/web-pwa e2e:install   # one-time: install chromium
pnpm --filter @salt/web-pwa e2e

# Or reuse a long-running emulator session you already have
pnpm dev:emulators                         # in one shell
pnpm --filter @salt/web-pwa dev            # in another (optional — Playwright will start vite if needed)
pnpm --filter @salt/web-pwa e2e            # in a third
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
