import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';

test('devSignIn signs the user in and the app shell renders the email', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);

  await page.goto('/');
  await expect(page.getByText(/sign in to salt/i)).toBeVisible();

  await signIn(page, email);

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
});
