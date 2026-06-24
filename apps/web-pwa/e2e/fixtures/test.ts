/// <reference path="../../src/lib/types/e2e.d.ts" />
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect } from '@playwright/test';
import { attachFailureSnapshot } from '../helpers/diagnostics';
import { FIRESTORE_EMULATOR_CLEAR_URL } from '../helpers/emulator';

declare const process: { env: Record<string, string | undefined> };

const E2E_RAW_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'coverage',
  'e2e-raw',
);

interface AutoFixtures {
  readonly clearFirestore: void;
  readonly coverageData: void;
  readonly failureSnapshot: void;
}

export const test = baseTest.extend<AutoFixtures>({
  clearFirestore: [
    async ({}, use) => {
      const resp = await fetch(FIRESTORE_EMULATOR_CLEAR_URL, { method: 'DELETE' });
      if (!resp.ok && resp.status !== 404) {
        throw new Error(`Failed to clear Firestore emulator: HTTP ${resp.status}`);
      }
      await use();
    },
    { auto: true },
  ],

  coverageData: [
    async ({ page }, use, testInfo) => {
      await page.coverage.startJSCoverage();
      await use();
      const coverage = await page.coverage.stopJSCoverage();
      const safeName = testInfo.title
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
      await mkdir(E2E_RAW_DIR, { recursive: true });
      await writeFile(
        join(E2E_RAW_DIR, `${safeName}-${testInfo.testId}.json`),
        JSON.stringify(coverage),
      );
    },
    { auto: true },
  ],

  // PURE DIAGNOSTICS: on a failing test, attach the primary page's last-seen
  // store state so the next CI flake is diagnosable from the artifacts alone.
  // Passing tests are a no-op (status === expectedStatus → early return); this
  // never changes a pass/fail outcome. Reads the page during fixture teardown,
  // which is safe — the page is still alive (same pattern as coverageData).
  failureSnapshot: [
    async ({ page }, use, testInfo) => {
      await use();
      await attachFailureSnapshot(testInfo, page);
    },
    { auto: true },
  ],
});

export { expect };
