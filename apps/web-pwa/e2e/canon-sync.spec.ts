/**
 * Two-tab convergence tests for manifest-driven canon sync.
 *
 * Each test opens two separate browser contexts (simulating two independent
 * browser tabs/sessions) against the running emulator. One context seeds or
 * edits data; the other polls until its local store reflects the change.
 *
 * Convergence is driven by the manifest subscription: when the CF trigger
 * increments a revision counter, each connected client detects the change
 * and pulls the delta.
 *
 * Requirements:
 *   - Firestore + Auth emulators running (started by playwright.config.ts webServer)
 *   - pnpm --filter @salt/web-pwa e2e
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { withConvergenceDiagnostics } from './helpers/diagnostics';
import {
  getAisles,
  getCanonItem,
  seedAisles,
  seedCanonItem,
  waitForCanonReady,
} from './helpers/seed';
// CONVERGENCE_TIMEOUT bounds cross-tab propagation (emulator is fast but sync is async).
import { CONVERGENCE_TIMEOUT } from './helpers/timeouts';

test.describe('canon sync — two-tab convergence', () => {
  // RESIDUAL FLAKE INSURANCE (#199): the root fix for the cross-client Listen
  // flake — forcing long-polling on the emulator transport (#122, init.ts) —
  // removed the bulk of these failures, but a fresh single-doc aisle listen
  // still occasionally loses the convergence race on emulator cold paths (a
  // propagation timeout, not a real break). Bounded retries absorb that
  // residual; it self-recovers on the first retry. Do NOT remove without
  // confirming the bare suite stays green across several CI runs.
  test.describe.configure({ retries: 2 });

  test('canon item created in tab A appears in tab B via manifest tick', async ({
    browser,
  }, testInfo) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const emailA = uniqueEmail(testInfo.testId + '-a');
      const emailB = uniqueEmail(testInfo.testId + '-b');
      const itemId = 'sync-item-' + testInfo.testId.replace(/[^a-z0-9]/gi, '-');

      // Both tabs sign in (same single-workspace, different users see same data).
      await gotoAndSignIn(page1, emailA);
      await gotoAndSignIn(page2, emailB);

      // Both tabs must have their canon listeners attached and settled before
      // any cross-tab write — otherwise a listener attaching mid-navigation can
      // miss the delta on the emulator's forced long-polling transport (#199).
      await waitForCanonReady(page1);
      await waitForCanonReady(page2);

      // Tab A seeds a new canon item.
      await seedCanonItem(page1, { id: itemId, name: 'Sync Test Item' });

      // Tab B polls until the item arrives via the manifest subscription.
      await withConvergenceDiagnostics(testInfo, page2, 'canon-item-arrives', async () => {
        await expect
          .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
          .not.toBeNull();
      });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('aisles edited in tab A appear in tab B via manifest tick', async ({
    browser,
  }, testInfo) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const emailA = uniqueEmail(testInfo.testId + '-a');
      const emailB = uniqueEmail(testInfo.testId + '-b');

      await gotoAndSignIn(page1, emailA);
      await gotoAndSignIn(page2, emailB);

      // Both tabs must have their canon listeners attached and settled before
      // any cross-tab write — otherwise a listener attaching mid-navigation can
      // miss the delta on the emulator's forced long-polling transport (#199).
      await waitForCanonReady(page1);
      await waitForCanonReady(page2);

      // Tab A writes aisles.
      const created = await seedAisles(page1, ['Produce', 'Dairy']);
      expect(created).toHaveLength(2);

      // Tab B polls until both aisles arrive.
      await withConvergenceDiagnostics(testInfo, page2, 'aisles-converge', async () => {
        await expect.poll(() => getAisles(page2), { timeout: CONVERGENCE_TIMEOUT }).toHaveLength(2);
      });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('items and aisles use independent revision counters', async ({ browser }, testInfo) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const emailA = uniqueEmail(testInfo.testId + '-a');
      const emailB = uniqueEmail(testInfo.testId + '-b');
      const itemId = 'counter-item-' + testInfo.testId.replace(/[^a-z0-9]/gi, '-');

      await gotoAndSignIn(page1, emailA);
      await gotoAndSignIn(page2, emailB);

      // Both tabs must have their canon listeners attached and settled before
      // any cross-tab write — otherwise a listener attaching mid-navigation can
      // miss the delta on the emulator's forced long-polling transport (#199).
      await waitForCanonReady(page1);
      await waitForCanonReady(page2);

      // Write an aisle first.
      await seedAisles(page1, ['Bakery']);
      await withConvergenceDiagnostics(testInfo, page2, 'bakery-aisle-converges', async () => {
        await expect
          .poll(async () => (await getAisles(page2)).some((a) => a.name === 'Bakery'), {
            timeout: CONVERGENCE_TIMEOUT,
          })
          .toBe(true);
      });

      // Now write an item — it must propagate independently.
      await seedCanonItem(page1, { id: itemId, name: 'Bread' });
      await withConvergenceDiagnostics(testInfo, page2, 'bread-item-converges', async () => {
        await expect
          .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
          .not.toBeNull();
      });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('offline tab edits drain and propagate after going back online', async ({
    browser,
  }, testInfo) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const emailA = uniqueEmail(testInfo.testId + '-a');
      const emailB = uniqueEmail(testInfo.testId + '-b');
      const itemId = 'offline-item-' + testInfo.testId.replace(/[^a-z0-9]/gi, '-');

      await gotoAndSignIn(page1, emailA);
      await gotoAndSignIn(page2, emailB);

      // Both tabs must have their canon listeners attached and settled before
      // any cross-tab write — otherwise a listener attaching mid-navigation can
      // miss the delta on the emulator's forced long-polling transport (#199).
      await waitForCanonReady(page1);
      await waitForCanonReady(page2);

      // Take ctx1 offline via the SDK (more reliable than browser-level setOffline on WSL).
      await page1.evaluate(() => window.__e2e!.setFirestoreOffline(true));
      await seedCanonItem(page1, { id: itemId, name: 'Offline Edit' });

      // While ctx1 is offline, the offline write must NOT reach tab B (negative
      // property — no early leak before ctx1 reconnects). Hold a window, then
      // confirm tab B still sees nothing. The prior `.poll().toBeNull().catch()`
      // was a no-op: it passed trivially (the item was already absent on B) and
      // the `.catch` silently swallowed the one case that mattered — a leak.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- NF-A2: bounded negative hold (no early leak while offline)
      await page2.waitForTimeout(2000);
      expect(await getCanonItem(page2, itemId)).toBeNull();

      // Bring ctx1 back online — pending writes drain and propagate.
      await page1.evaluate(() => window.__e2e!.setFirestoreOffline(false));

      await withConvergenceDiagnostics(testInfo, page2, 'offline-drain-converges', async () => {
        await expect
          .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
          .not.toBeNull();
      });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
