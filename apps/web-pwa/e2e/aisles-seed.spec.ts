import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';
import { seedAisles } from './helpers/seed';

test('seedAisles writes aisles that render on /admin/aisles', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);

  await page.goto('/');
  await signIn(page, email, { admin: true });
  await expect(page.getByText(email)).toBeVisible();

  const seeded = await seedAisles(page, ['Produce', 'Dairy']);
  expect(seeded.map((a) => a.name)).toEqual(['Produce', 'Dairy']);

  await page.goto('/#/admin/aisles');

  await expect(page.getByRole('heading', { name: /manage aisles/i })).toBeVisible();
  await expect(page.getByText('Produce', { exact: true })).toBeVisible();
  await expect(page.getByText('Dairy', { exact: true })).toBeVisible();
});
