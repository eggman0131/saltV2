/**
 * Cold start: aisles that were ALREADY in Firestore before the app launched.
 *
 * NOT a duplicate of issue-12-aisles.spec.ts, which covers the write path — it
 * drives the real bulk-add dialog (→ `addAislesBulk` → `saveAisles`) and then
 * asserts the same page. That test navigates to /admin/aisles and adds from
 * there, so the aisle list is always populated by an update arriving at a
 * listener that is already attached.
 *
 * This one covers the other direction, which nothing else does: the document is
 * in place BEFORE the app boots, so the aisles reach the page on the listener's
 * FIRST snapshot. That is exactly the path `seedAislesBeforeBoot` moved the
 * aisle-seeding specs onto (issue #721), which makes this the regression test
 * for that mechanism. Deleting it as redundant would leave the mechanism
 * untested — the assertions look alike, the paths do not.
 */
import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';
import { seedAislesBeforeBoot } from './helpers/seed';

test('aisles already in Firestore render on /admin/aisles from the first snapshot', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);

  // Before `page.goto` — the whole point of this spec is that the document
  // exists before the app attaches its listener. See `seedAislesBeforeBoot`.
  const seeded = await seedAislesBeforeBoot(['Produce', 'Dairy']);
  expect(seeded.map((a) => a.name)).toEqual(['Produce', 'Dairy']);

  await page.goto('/');
  await signIn(page, email, { admin: true });
  // Signed-in gate. The header's Kitchen link replaced the email span in #828.
  await expect(page.getByTestId('kitchen-link')).toBeVisible();

  await page.goto('/#/admin/aisles');

  await expect(page.getByRole('heading', { name: /manage aisles/i })).toBeVisible();
  await expect(page.getByText('Produce', { exact: true })).toBeVisible();
  await expect(page.getByText('Dairy', { exact: true })).toBeVisible();
});
