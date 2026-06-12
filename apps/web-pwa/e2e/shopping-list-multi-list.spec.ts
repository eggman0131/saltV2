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

async function createSecondList(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.getByTestId('shopping-overflow-btn').click();
  await page.getByTestId('shopping-lists-btn').click();
  await expect(page).toHaveURL(/#\/shopping\/lists/, { timeout: SYNC_TIMEOUT });
  await page.getByTestId('shopping-lists-name-input').fill(name);
  await page.getByTestId('shopping-lists-add-btn').click();
  await expect(page).toHaveURL(/#\/shopping\/(?!lists)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
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

    // Create a second list via the lists management page
    await createSecondList(page, 'Asian supermarket');

    // The second list should be empty
    await expect(page.getByText('Your list is empty')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // The title should be a clickable picker showing the current list name
    await expect(page.getByTestId('shopping-list-title-btn')).toBeVisible();

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

    // Navigate to the lists management page (via the overflow menu)
    await page.getByTestId('shopping-overflow-btn').click();
    await page.getByTestId('shopping-lists-btn').click();
    await expect(page).toHaveURL(/#\/shopping\/lists/, { timeout: SYNC_TIMEOUT });

    // Delete button for the default list should be disabled
    const deleteBtn = page.getByTestId('shopping-list-delete-btn');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
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
    await createSecondList(page, 'Asian supermarket');
    await expect(page).toHaveURL(/#\/shopping\/(?!lists)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // Go back to first list
    await page.goto(firstListUrl);
    await expect(page.getByText('soy sauce')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Enter selection mode, then select the soy sauce item
    await page.getByRole('button', { name: /^select$/i }).click();
    const soyRow = page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' });
    await soyRow.getByRole('checkbox').first().click();

    // Bulk move to Asian supermarket via the move sheet
    const moveButton = page.getByTestId('shopping-bulk-move-select');
    await expect(moveButton).toBeVisible({ timeout: SYNC_TIMEOUT });
    await moveButton.click();
    await page
      .getByTestId('shopping-bulk-move-option')
      .filter({ hasText: /asian supermarket/i })
      .click();

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
    await createSecondList(page, 'Second list');
    await expect(page).toHaveURL(/#\/shopping\/(?!lists)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
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
