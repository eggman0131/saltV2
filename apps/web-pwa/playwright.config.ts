import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**'],
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI
    ? [['html'], ['github'], ['./e2e/reporter/ldSessionReporter.ts']]
    : [['html'], ['list'], ['./e2e/reporter/ldSessionReporter.ts']],
  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',

  use: {
    baseURL: 'http://127.0.0.1:5174',
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // NOTE: Playwright does NOT manage the e2e web server. Its `webServer` readiness
  // probe does a raw socket connect that deadlocks on this WSL2 host's free-port
  // blackhole (issue #79). The dedicated e2e app server on :5174 (wired to the test
  // emulator ports) is owned by e2e/globalSetup.ts + e2e/globalTeardown.ts instead.
  // Do not re-introduce a `webServer` block here.
});
