import { defineConfig, devices } from '@playwright/test';
import { E2E_APP_ORIGIN } from './e2e/e2eAppOrigin';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**'],
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Lazy admin-route chunks (#411 code-split; Leaflet-heavy) can take >5s to
  // fetch+mount on a cold CI navigation, racing the default 5s expect timeout —
  // the source of the intermittent "/#/admin/… heading not found" flakes. Give
  // assertions headroom rather than patching each admin spec.
  expect: { timeout: 10_000 },
  workers: 1,
  // The third CI reporter writes e2e-flake-events.ndjson — one record per test,
  // INCLUDING the ones that passed on retry, which every other output here
  // discards (issue #669). CI ships it to PostHog; see the reporter's header for
  // why it emits capture-shaped JSON without importing a PostHog SDK.
  // CI-only on purpose: a local run has no branch/sha/run context worth keeping,
  // and nothing uploads the file.
  reporter: CI ? [['html'], ['github'], ['./e2e/reporter/flakeReporter.ts']] : [['html'], ['list']],
  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',

  use: {
    // Single source of truth in ./e2e/e2eAppOrigin.ts (#1142 review, finding 1).
    baseURL: E2E_APP_ORIGIN,
    // retain-on-failure, NOT on-first-retry: for a "passes on retry" flake,
    // on-first-retry keeps the trace of the *retry* (which passed) — useless for
    // diagnosis. retain-on-failure keeps the trace + video of whichever attempt
    // actually failed. These are the CI debugging path (download the artifact,
    // `npx playwright show-trace`); see docs/e2e-test-spec.md (NF-G4).
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      // The default desktop project runs every spec EXCEPT the touch-emulated ones
      // (`*.touch.spec.ts`), which need a coarse pointer the swipe gesture gates on
      // (see the mobile-touch project). The ignore list is a superset of the global
      // testIgnore so the fixtures/helpers/reporter exclusions hold regardless of
      // whether Playwright merges or replaces the global value per-project.
      testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**', '**/*.touch.spec.ts'],
      // A `@quarantine`-tagged test leaves the gating run the moment it is tagged
      // — see the quarantine project below.
      grepInvert: /@quarantine/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // A single coarse-pointer touch project for the touch-only shopping-row swipe
      // (lively list, Phase 4). Scoped by testMatch to ONLY the `*.touch.spec.ts`
      // files so it never re-runs the whole (desktop-shaped) suite under mobile
      // emulation. `reducedMotion: 'no-preference'` is explicit so the swipe action
      // — which no-ops under reduced motion — is actually exercised.
      name: 'mobile-touch',
      testMatch: '**/*.touch.spec.ts',
      grepInvert: /@quarantine/,
      use: { ...devices['Pixel 5'], reducedMotion: 'no-preference' },
    },
    {
      // Quarantine (issue #721). A KNOWN-flaky test is habitual amber: everyone
      // learns to re-run it, and the next NEW flake arrives into a suite nobody
      // trusts, so it reads as more of the same. Moving the known offender here
      // restores that signal — the gating projects go back to meaning something,
      // and the quarantined test keeps running with the SAME reporters and the
      // SAME retries, so its PostHog flake record (issue #669) is unbroken and
      // you can still see whether it is getting better or worse.
      //
      // It is NOT a fix, and not a place to park a test. A quarantined test is a
      // bug still owed a fix (NF-G3: a retry-pass is a bug, not a green) — it is
      // tracked and un-quarantined, never left. See docs/e2e.md.
      //
      // To quarantine: put `@quarantine` in the test's title — per TEST, not per
      // file, because the flakiness is per test (one rotten test in a five-test
      // spec must not take the other four out of the gate with it).
      //
      // Ships with zero members on purpose.
      name: 'quarantine',
      testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**', '**/*.touch.spec.ts'],
      grep: /@quarantine/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // NOTE: Playwright does NOT manage the e2e web server. Its `webServer` readiness
  // probe does a raw socket connect that deadlocks on this WSL2 host's free-port
  // blackhole (issue #79). The dedicated e2e app server on :5174 (wired to the test
  // emulator ports) is owned by e2e/globalSetup.ts + e2e/globalTeardown.ts instead.
  // Do not re-introduce a `webServer` block here.
});
