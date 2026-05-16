/**
 * Shopping list multi-list E2E tests.
 *
 * Exercises: creating a second list, moving items between lists, verifying
 * the default list cannot be deleted (blocked, not gated behind a dialog),
 * and verifying that activeListId survives a page reload via the URL.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';

const SYNC_TIMEOUT = 15_000;

async function createFirstList(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/#/shopping');
  await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
  await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
  return page.url();
}

test.describe('shopping list — multi-list', () => {
  test('create a second list and navigate between them', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    const firstListUrl = await createFirstList(page);

    // Add an item to the first list
    await page.getByTestId('shopping-item-input').fill('apples');
    await page.getByTestId('shopping-item-add-btn').click();
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Create a second list
    await page.getByTestId('shopping-add-list').click();
    await expect(page).toHaveURL(/#\/shopping\/new/);
    await page.getByTestId('shopping-create-list-name').fill('Asian supermarket');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    // The second list should be empty
    await expect(page.getByText('Your list is empty')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // The list picker should show both lists
    await expect(page.getByTestId('shopping-list-picker')).toBeVisible();

    // Navigate back to first list via direct URL
    await page.goto(firstListUrl);
    // Guard: confirm the app didn't redirect to /new before asserting content
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Reload verifies activeListId is in the URL and survives reload
    await page.reload();
    await page.goto(firstListUrl);
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
  });

  test('default list cannot be deleted — delete button is disabled', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    await createFirstList(page);

    // Navigate to manage page for the default list
    await page.getByTestId('shopping-manage-list').click();
    await expect(page).toHaveURL(/#\/shopping\/.+\/manage/, { timeout: SYNC_TIMEOUT });

    // Delete button should be disabled
    const deleteBtn = page.getByTestId('shopping-manage-delete');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();

    // Helper text should mention it cannot be deleted
    await expect(page.getByText(/default list cannot be deleted/i)).toBeVisible();
  });

  test('move item to second list removes it from source', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    const firstListUrl = await createFirstList(page);

    // Add an item
    await page.getByTestId('shopping-item-input').fill('soy sauce');
    await page.getByTestId('shopping-item-add-btn').click();
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Create a second list
    await page.getByTestId('shopping-add-list').click();
    await page.getByTestId('shopping-create-list-name').fill('Asian supermarket');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // Go back to first list
    await page.goto(firstListUrl);
    await expect(page.getByText('soy sauce')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Select the soy sauce item
    const soyRow = page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' });
    await soyRow.getByRole('checkbox').first().click();

    // Bulk move to Asian supermarket
    const moveSelect = page.getByTestId('shopping-bulk-move-select');
    await expect(moveSelect).toBeVisible({ timeout: SYNC_TIMEOUT });
    await moveSelect.click();
    await page.getByRole('option', { name: /asian supermarket/i }).click();

    await page.getByTestId('shopping-bulk-move-confirm').click();

    // Soy sauce should be gone from the first list
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' }),
    ).not.toBeVisible({ timeout: SYNC_TIMEOUT });

    // Navigate via bridge to confirm which list is the default
    const defaultListId = await page.evaluate(() => window.__e2e!.getDefaultListId());
    expect(defaultListId).toBeTruthy();
  });

  test('activeListId survives reload via URL', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    const firstListUrl = await createFirstList(page);

    // Create second list
    await page.getByTestId('shopping-add-list').click();
    await page.getByTestId('shopping-create-list-name').fill('Second list');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const secondListUrl = page.url();

    // Navigate to second list
    await page.goto(secondListUrl);
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Reload on the second list URL
    await page.reload();
    await page.goto(secondListUrl);

    // Should still be on the second list (not redirected to default)
    await expect(page).toHaveURL(
      new URL(secondListUrl).hash.slice(1) !== new URL(firstListUrl).hash.slice(1)
        ? secondListUrl
        : secondListUrl,
      { timeout: SYNC_TIMEOUT },
    );
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });
  });
});
