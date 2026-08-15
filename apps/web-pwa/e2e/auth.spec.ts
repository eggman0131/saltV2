import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';

test('devSignIn signs the user in and the app shell renders', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);

  await page.goto('/');
  await expect(page.getByText(/sign in to salt/i)).toBeVisible();

  await signIn(page, email);

  // The chrome stopped showing the signed-in email in #828 — the header carries a
  // link into Kitchen instead. That link is what now proves the shell has rendered
  // for a signed-in user; it is present at every width and on every page.
  await expect(page.getByTestId('kitchen-link')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
});
