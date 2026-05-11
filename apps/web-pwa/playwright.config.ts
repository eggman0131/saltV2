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
      command:
        'node scripts/stop-emulators.mjs && firebase emulators:start --project=demo-salt --only=auth,firestore,functions',
      cwd: '../..',
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: CI ? 'inherit' : 'pipe',
      stderr: CI ? 'inherit' : 'pipe',
    },
    {
      command: 'vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: CI ? 'inherit' : 'pipe',
      stderr: CI ? 'inherit' : 'pipe',
    },
  ],
});
