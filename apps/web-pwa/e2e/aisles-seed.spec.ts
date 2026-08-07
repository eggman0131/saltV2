import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';
import { seedAislesBeforeBoot } from './helpers/seed';

test('seeded aisles render on /admin/aisles', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);

  // Before `page.goto` — the aisles document must exist before the app attaches
  // its listener to it. See `seedAislesBeforeBoot`.
  const seeded = await seedAislesBeforeBoot(['Produce', 'Dairy']);
  expect(seeded.map((a) => a.name)).toEqual(['Produce', 'Dairy']);

  await page.goto('/');
  await signIn(page, email, { admin: true });
  await expect(page.getByText(email)).toBeVisible();

  await page.goto('/#/admin/aisles');

  await expect(page.getByRole('heading', { name: /manage aisles/i })).toBeVisible();
  await expect(page.getByText('Produce', { exact: true })).toBeVisible();
  await expect(page.getByText('Dairy', { exact: true })).toBeVisible();
});
