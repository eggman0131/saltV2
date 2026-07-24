/**
 * Shopping row swipe — DESKTOP guarantees (lively shopping list, Phase 4).
 *
 * The swipe gesture is touch-only and coarse-pointer gated. This spec runs under
 * the default desktop `chromium` project (a fine mouse pointer) and pins the two
 * desktop invariants that are fully deterministic:
 *
 *   1. Rows are NOT draggable with a mouse — a horizontal mouse drag past the
 *      swipe thresholds neither checks nor deletes the row.
 *   2. Every row can still be checked in sequence via its button, with no
 *      stuck-pointer regression (an exiting/animating row must not swallow the
 *      next row's click).
 *
 * The touch case (an actual past-threshold swipe) lives in
 * `shopping-swipe.touch.spec.ts`, which runs only under the coarse-pointer
 * `mobile-touch` project — a mouse cannot produce a `pointerType: 'touch'` event.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

async function createListWithItems(
  page: import('@playwright/test').Page,
  items: readonly string[],
): Promise<string> {
  await page.goto('/#/shopping');
  await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
  await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/#\/shopping\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

  const input = page.getByTestId('shopping-item-input');
  const addBtn = page.getByTestId('shopping-item-add-btn');
  for (const item of items) {
    await input.fill(item);
    await addBtn.click();
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: item })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
  }
  return page.url();
}

test.describe('shopping row swipe — desktop (mouse) behaviour', () => {
  test('a mouse drag does not check or delete a row (rows are not draggable)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId));
    await createListWithItems(page, ['apples']);

    const other = page.getByTestId('shopping-other');
    const applesRow = other.getByTestId('shopping-item-row').filter({ hasText: 'apples' });
    await expect(applesRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Drag the row right, well past the +78px check threshold, with the MOUSE.
    // Start over the left icon zone (non-interactive) so mousedown/up straddle no
    // single button; a touch swipe here would check the row — a mouse must not.
    const box = (await applesRow.boundingBox())!;
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + 8, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + 8 + 160, midY, { steps: 10 });
    await page.mouse.up();

    // Nothing happened: the row is still an unchecked item in Other, and there is
    // no delete (no undo snackbar) and no check (no Clear checked button).
    await expect(applesRow).toBeVisible();
    await expect(page.getByRole('button', { name: /undo/i })).toHaveCount(0);
    await expect(page.getByTestId('shopping-clear-checked')).toHaveCount(0);
  });

  test('every row can be checked in sequence via its button (no stuck pointer)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId));
    await createListWithItems(page, ['apples', 'bananas', 'carrots']);

    const other = page.getByTestId('shopping-other');

    // Check each row via its own button, one after another. If an exiting/animating
    // row swallowed the next row's click (a stuck-pointer regression), a later click
    // would miss and that row would never leave Other — the final assertion catches it.
    for (const item of ['apples', 'bananas', 'carrots']) {
      const row = other.getByTestId('shopping-item-row').filter({ hasText: item });
      await row.getByTestId('shopping-item-check').click();
      await expect(other.getByTestId('shopping-item-row').filter({ hasText: item })).toHaveCount(
        0,
        { timeout: SYNC_TIMEOUT },
      );
    }

    // All three landed in Checked: the Clear checked button is present and Other has
    // no active rows left.
    await expect(page.getByTestId('shopping-clear-checked')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByTestId('shopping-item-row')).toHaveCount(0, { timeout: SYNC_TIMEOUT });
  });
});
