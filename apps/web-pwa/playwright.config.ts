import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**'],
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: 1,
  reporter: CI
    ? [['html'], ['github'], ['./e2e/reporter/ldSessionReporter.ts']]
    : [['html'], ['list'], ['./e2e/reporter/ldSessionReporter.ts']],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // fuser -k clears orphaned emulator Java subprocesses left behind when
      // the Firebase CLI is killed (common in WSL). The reuseExistingServer
      // check uses port 9099 (auth emulator) rather than the hub (4400) so
      // that tests only start once the auth emulator is fully initialised —
      // the hub responds before individual emulators are ready.
      command:
        'fuser -k 8080/tcp 9099/tcp 2>/dev/null; pnpm --filter @salt/cloud-functions build && firebase emulators:start --project=demo-salt --only=auth,firestore',
      cwd: '../..',
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'vite',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
