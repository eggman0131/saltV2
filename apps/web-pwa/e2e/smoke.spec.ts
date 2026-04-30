import { test, expect } from './fixtures/test';

test('app loads and shows the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/sign in to salt/i)).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send magic link/i })).toBeVisible();
});
