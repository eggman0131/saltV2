/// <reference path="../../src/lib/types/e2e.d.ts" />
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect } from '@playwright/test';
import type { ObservabilitySessionMeta } from '@salt/ld-observability';

declare const process: { env: Record<string, string | undefined> };

const E2E_RAW_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'coverage',
  'e2e-raw',
);

const FIRESTORE_EMULATOR_CLEAR_URL =
  'http://127.0.0.1:8080/emulator/v1/projects/demo-salt/databases/(default)/documents';

interface AutoFixtures {
  readonly observabilitySession: void;
  readonly clearFirestore: void;
  readonly coverageData: void;
}

function buildSessionMeta(testName: string, testId: string): ObservabilitySessionMeta {
  return {
    e2e: true,
    testName,
    testId,
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    branch: process.env.GITHUB_REF_NAME ?? 'local',
    ...(process.env.GITHUB_JOB ? { ciJob: process.env.GITHUB_JOB } : {}),
  };
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

  observabilitySession: [
    async ({ page }, use, testInfo) => {
      const meta = buildSessionMeta(testInfo.title, testInfo.testId);
      await page.addInitScript((m) => {
        window.__e2eAutoTag = m;
      }, meta);

      await use();

      const url = await page
        .evaluate(() => window.__e2e?.getLDSessionURL() ?? null)
        .catch(() => null);
      if (url) {
        await testInfo.attach('ld-session', {
          body: url,
          contentType: 'text/uri-list',
        });
        (testInfo as { ldSessionURL?: string }).ldSessionURL = url;
      }
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
});

export { expect };
