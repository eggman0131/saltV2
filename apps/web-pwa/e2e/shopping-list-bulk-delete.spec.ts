/**
 * Shopping list bulk delete + Undo E2E tests (issue #115).
 *
 * Exercises the contextual-action-mode delete that lives in the shared ListPage
 * template: selecting items, deleting via the bottom action bar, and the
 * deferred-delete + Undo snackbar (no confirm dialog, no soft-delete). Two
 * outcomes are covered:
 *   - Undo within the window → the item reappears and is never deleted.
 *   - Letting the toast lapse → the delete commits to Firestore (survives reload).
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';

const SYNC_TIMEOUT = 15_000;

async function createListWithItem(
  page: import('@playwright/test').Page,
  itemText: string,
): Promise<string> {
  await page.goto('/#/shopping');
  await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
  await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

  await page.getByTestId('shopping-item-input').fill(itemText);
  await page.getByTestId('shopping-item-add-btn').click();
  await expect(page.getByTestId('shopping-item-row').filter({ hasText: itemText })).toBeVisible({
    timeout: SYNC_TIMEOUT,
  });

  return page.url();
}

async function selectAndDelete(
  page: import('@playwright/test').Page,
  itemText: string,
): Promise<void> {
  // Enter selection mode and tick the item's row checkbox.
  await page.getByRole('button', { name: /^select$/i }).click();
  const row = page.getByTestId('shopping-item-row').filter({ hasText: itemText });
  await row.getByRole('checkbox').first().click();

  // The contextual bottom bar's Delete action (rendered by the ListPage template).
  const deleteBtn = page.getByTestId('shopping-bulk-delete');
  await expect(deleteBtn).toBeVisible({ timeout: SYNC_TIMEOUT });
  await deleteBtn.click();
}

test.describe('shopping list — bulk delete + undo', () => {
  test('delete then Undo restores the item (nothing is deleted)', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    const listUrl = await createListWithItem(page, 'apples');

    await selectAndDelete(page, 'apples');

    // The row hides immediately and the Undo snackbar appears.
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toHaveCount(
      0,
      { timeout: SYNC_TIMEOUT },
    );
    const undo = page.getByRole('button', { name: /undo/i });
    await expect(undo).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Undo cancels the deferred delete — the item comes back.
    await undo.click();
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // It is genuinely still there after a reload (never committed to Firestore).
    await page.goto(listUrl);
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
  });

  test('delete then letting the toast lapse commits the delete', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    const listUrl = await createListWithItem(page, 'bananas');

    await selectAndDelete(page, 'bananas');

    // Row hides immediately; do NOT press Undo. Wait for the snackbar to lapse,
    // which commits the delete.
    const undo = page.getByRole('button', { name: /undo/i });
    await expect(undo).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(undo).toHaveCount(0, { timeout: SYNC_TIMEOUT });

    // After a reload the item is gone — the deferred delete committed to Firestore.
    await page.goto(listUrl);
    await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByText('Your list is empty')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'bananas' })).toHaveCount(
      0,
    );
  });
});
