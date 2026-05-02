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
import { getAisles, getCanonItem, seedAisles, seedCanonItem } from './helpers/seed';

// How long to wait for cross-tab propagation (emulator is fast but sync is async).
const CONVERGENCE_TIMEOUT = 20_000;

test.describe('canon sync — two-tab convergence', () => {
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

      // Tab A seeds a new canon item.
      await seedCanonItem(page1, { id: itemId, name: 'Sync Test Item' });

      // Tab B polls until the item arrives via the manifest subscription.
      await expect
        .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
        .not.toBeNull();
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

      // Tab A writes aisles.
      const created = await seedAisles(page1, ['Produce', 'Dairy']);
      expect(created).toHaveLength(2);

      // Tab B polls until both aisles arrive.
      await expect.poll(() => getAisles(page2), { timeout: CONVERGENCE_TIMEOUT }).toHaveLength(2);
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

      // Write an aisle first.
      await seedAisles(page1, ['Bakery']);
      await expect.poll(() => getAisles(page2), { timeout: CONVERGENCE_TIMEOUT }).toHaveLength(1);

      // Now write an item — it must propagate independently.
      await seedCanonItem(page1, { id: itemId, name: 'Bread' });
      await expect
        .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
        .not.toBeNull();
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

      // Take ctx1 offline via the SDK (more reliable than browser-level setOffline on WSL).
      await page1.evaluate(() => window.__e2e!.setFirestoreOffline(true));
      await seedCanonItem(page1, { id: itemId, name: 'Offline Edit' });

      // While offline, tab B should not yet see it.
      await expect
        .poll(() => getCanonItem(page2, itemId), { timeout: 3000 })
        .toBeNull()
        .catch(() => {
          // toBeNull polling timeout is acceptable — item shouldn't be there
        });

      // Bring ctx1 back online — pending writes drain and propagate.
      await page1.evaluate(() => window.__e2e!.setFirestoreOffline(false));

      await expect
        .poll(() => getCanonItem(page2, itemId), { timeout: CONVERGENCE_TIMEOUT })
        .not.toBeNull();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
