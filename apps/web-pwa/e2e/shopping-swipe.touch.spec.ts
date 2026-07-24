/**
 * Shopping row swipe — TOUCH case (lively shopping list, Phase 4).
 *
 * Runs ONLY under the coarse-pointer `mobile-touch` Playwright project (see
 * `playwright.config.ts`, matched by the `*.touch.spec.ts` name): the swipe action
 * gates on `matchMedia('(pointer: coarse)')` + `pointerType === 'touch'`, so a
 * desktop mouse can never trigger it. `reducedMotion: 'no-preference'` is set on the
 * project so the action (which no-ops under reduced motion) is actually exercised.
 *
 * Deliberately DETERMINISTIC, per the repo's e2e guidance (`cook-mode.spec.ts`:
 * synthesised pointer physics is "flake rather than signal"): each test drives ONE
 * clean, past-threshold horizontal drag via dispatched touch-pointer events and
 * asserts the END STATE (checked → Clear checked appears; deleted → undo snackbar).
 * No fling velocity, no sub-threshold spring-back, no `waitForTimeout` — those
 * (velocity, thresholds, the spring-back decision) are covered by the pure-math unit
 * tests in `tests/swipe.test.ts`.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

async function createListWithItem(page: Page, itemText: string): Promise<void> {
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
}

// One controlled horizontal touch drag on `row`: press at its centre, move in a
// handful of even steps to `totalDx` px (positive = right / check, negative = left /
// delete), release. Dispatched touch-pointer events bypass `touch-action` and real
// hit-testing, so the motion is exactly reproducible — the whole point of driving
// the outcome rather than the physics.
async function touchSwipe(row: Locator, totalDx: number): Promise<void> {
  const box = (await row.boundingBox())!;
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const send = (type: string, clientX: number): Promise<void> =>
    row.dispatchEvent(type, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX,
      clientY: y,
      bubbles: true,
    });

  await send('pointerdown', startX);
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    await send('pointermove', startX + (totalDx * i) / steps);
  }
  await send('pointerup', startX + totalDx);
}

test.describe('shopping row swipe — touch', () => {
  test('swipe right past the threshold checks the item off', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId));
    await createListWithItem(page, 'apples');

    const other = page.getByTestId('shopping-other');
    const applesRow = other.getByTestId('shopping-item-row').filter({ hasText: 'apples' });
    await expect(applesRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Well past +78px → check. The item runs the check-off celebration and lands in
    // Checked: the Clear checked button appears and it leaves the active Other list.
    await touchSwipe(applesRow, 160);

    await expect(page.getByTestId('shopping-clear-checked')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByTestId('shopping-item-row').filter({ hasText: 'apples' })).toHaveCount(
      0,
      { timeout: SYNC_TIMEOUT },
    );
  });

  test('swipe left past the threshold deletes the item with an undo snackbar', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId));
    await createListWithItem(page, 'bananas');

    const bananasRow = page.getByTestId('shopping-item-row').filter({ hasText: 'bananas' });
    await expect(bananasRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Well past -78px → delete. The row hides immediately behind the shared undo
    // snackbar (the same deferred-delete path the edit sheet and bulk delete use).
    await touchSwipe(bananasRow, -160);

    await expect(page.getByRole('button', { name: /undo/i })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'bananas' })).toHaveCount(
      0,
      { timeout: SYNC_TIMEOUT },
    );
  });
});
