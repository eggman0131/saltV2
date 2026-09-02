/// <reference path="../../src/lib/types/e2e.d.ts" />
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as baseTest, expect } from '@playwright/test';
import { attachFailureSnapshot } from '../helpers/diagnostics';
import { FIRESTORE_EMULATOR_CLEAR_URL } from '../helpers/emulator';
import { seedDefaultAiStubs } from '../helpers/seed';

const E2E_RAW_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'coverage',
  'e2e-raw',
);

// ── E2E V8 coverage is OPT-IN (issue #945) ────────────────────────────────────
//
// This fixture is `auto`, so before #945 it ran around EVERY test on EVERY CI
// shard — `startJSCoverage`/`stopJSCoverage` per test, then a JSON file holding
// the SOURCE TEXT of every script the page had loaded (under the dev server that
// is the app, @salt/*, and Vite's pre-bundled deps, unminified and carrying
// inline source maps). CI never ran `e2e:coverage:report`, `coverage/e2e-raw/`
// was in no `upload-artifact` path, and the whole lot went into the bin with the
// runner. Full cost, no output.
//
// The choice made was OPT-IN rather than wiring a report into CI, on three
// grounds. (1) Nothing consumes it: there is no e2e coverage floor, no ratchet,
// no artifact — and the `.svelte` route layer the report would describe already
// carries a real unit-coverage floor (`apps/web-pwa/src/routes/**`, #966/#943).
// (2) Retaining it properly means uploading that raw JSON from all three shards
// and adding a fourth job to merge it — real, permanent, per-run cost bought for
// a report nobody has asked to read. (3) The per-test cost could not be
// measured: the "Run E2E tests" step swings 3:30–5:03 across shards of the same
// run, so the overhead is smaller than the noise — which makes it unproven, not
// free. Unproven cost for no consumer is a bad trade.
//
// Nothing is lost locally: `pnpm --filter @salt/web-pwa e2e:coverage` sets the
// flag itself and still produces the HTML + LCOV report, and `E2E_COVERAGE=1`
// in front of any `playwright test` collects on demand. Wiring a report into CI
// stays available if e2e coverage ever gains a consumer — flip the default and
// add the upload/merge; the collection code is untouched and still here.
//
// That last sentence used to be a hope (#1132). `apps/web-pwa/scripts/**` was in
// no typecheck program and CI sets `E2E_COVERAGE` nowhere, so a `v8-to-istanbul`
// major or a Vite port move could have rotted the report months before anyone
// reached for it. Two mechanisms now hold it, and both run under `pnpm test` /
// `pnpm typecheck` from any worktree — neither needs Playwright, which
// `e2e:coverage` being host-guarded rules out:
//   • `tests/e2eCoverageReport.test.ts` runs `process-e2e-coverage.ts` for real
//     over a raw V8 dump and asserts the per-function hit counts that come out.
//   • `tsconfig.test.json` now includes `scripts/**` — which found four type
//     errors in that script on the day it was switched on.
// Note the seam neither covers: the BRANCH BELOW needs a browser, so all that
// couples it to the guard is the dump shape. Change what is written here, or
// have Playwright change it, and that test keeps passing on the old shape.
const COLLECT_COVERAGE = process.env.E2E_COVERAGE === '1';

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
      // The wipe takes the AI stubs with it, so the defaults are re-seeded here
      // rather than in globalSetup — inside this fixture, not a second `auto`
      // one, so the ordering against the wipe is a sequence and not a guess.
      // Which flows get a default, and why the rest keep the loud throw, is at
      // `seedDefaultAiStubs` (issue #935).
      await seedDefaultAiStubs();
      await use();
    },
    { auto: true },
  ],

  coverageData: [
    async ({ page }, use, testInfo) => {
      if (!COLLECT_COVERAGE) {
        await use();
        return;
      }
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
