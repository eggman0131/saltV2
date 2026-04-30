import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/fixtures/**', '**/helpers/**', '**/reporter/**'],
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
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
        'pnpm --filter @salt/cloud-functions build && firebase emulators:start --project=demo-salt --only=auth,firestore',
      cwd: '../..',
      url: 'http://127.0.0.1:4400',
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
