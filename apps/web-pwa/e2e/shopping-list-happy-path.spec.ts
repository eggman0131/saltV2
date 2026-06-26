/**
 * Shopping list happy-path E2E tests.
 *
 * Exercises the core shopping list lifecycle against the Firestore + Auth
 * emulators: item capture, Needs Review → aisle routing (requires the
 * onShoppingListItemWrite CF trigger to be running), check/uncheck, clear
 * checked, and persistence across reload. Direct entries are not collapsed
 * even when they share a canon — each is its own row.
 *
 * The canon-match trigger must be running for items to graduate from Needs
 * Review into their aisles. In emulator-only mode without the trigger the
 * items remain in Needs Review — the test covers what it can without the
 * trigger firing.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail, waitForBridge } from './helpers/auth';
import { seedAisles, seedCanonItem } from './helpers/seed';
import { SYNC_TIMEOUT } from './helpers/timeouts';

test.describe('shopping list — happy path', () => {
  test('add items, check off, clear checked, reload, persist', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // ── Bootstrap: create the first list via the create page ─────────────────
    await page.goto('/#/shopping');
    // No lists exist yet → redirect to /shopping/new
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });

    await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
    await page.getByRole('button', { name: /create/i }).click();

    // Should redirect to the new list page
    await expect(page).toHaveURL(/#\/shopping\/[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-list-page')).toBeVisible();

    // ── Capture three items ──────────────────────────────────────────────────
    const input = page.getByTestId('shopping-item-input');
    const addBtn = page.getByTestId('shopping-item-add-btn');

    await input.fill('heinz baked beans 4 tins');
    await addBtn.click();
    await input.fill('whole milk 2L');
    await addBtn.click();
    await input.fill('cheddar cheese');
    await addBtn.click();

    // Items should appear in Other immediately (matchState: pending).
    //
    // Match the canonical-name substring, not the full raw entry: the
    // onShoppingListItemWrite trigger rewrites `rawText` to the parsed name
    // once it fires (e.g. "heinz baked beans 4 tins" → "heinz baked beans",
    // with "4 tins" lifted into amount/notes). Asserting the full raw string
    // races the trigger — the faster it matches, the sooner the raw text is
    // gone. The canonical substring is present both before and after the
    // rewrite, so these locators are stable regardless of trigger speed.
    // "cheddar cheese" has no amount/unit, so it is never rewritten and serves
    // as the unchanged control.
    const other = page.getByTestId('shopping-other');
    await expect(other).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByText(/heinz baked beans/i)).toBeVisible();
    await expect(other.getByText(/whole milk/i)).toBeVisible();
    await expect(other.getByText('cheddar cheese')).toBeVisible();

    // ── Check two items off ──────────────────────────────────────────────────
    // Find the first item row's shopping check checkbox and click it.
    const firstItemRow = other
      .getByTestId('shopping-item-row')
      .filter({ hasText: /heinz baked beans/i });
    await firstItemRow.getByTestId('shopping-item-check').click();

    const secondItemRow = other.getByTestId('shopping-item-row').filter({ hasText: /whole milk/i });
    await secondItemRow.getByTestId('shopping-item-check').click();

    // Clear checked button should now be visible
    await expect(page.getByTestId('shopping-clear-checked')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Clear checked ────────────────────────────────────────────────────────
    await page.getByTestId('shopping-clear-checked').click();

    // The two checked items should vanish; only cheddar cheese remains
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: /heinz baked beans/i }),
    ).not.toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: /whole milk/i }),
    ).not.toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByText('cheddar cheese')).toBeVisible();

    // ── Reload and verify persistence ────────────────────────────────────────
    const currentUrl = page.url();
    await page.reload();
    await page.goto(currentUrl);

    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('cheddar cheese')).toBeVisible({ timeout: SYNC_TIMEOUT });
    // The cleared item is genuinely gone (deleted), not merely rewritten —
    // match the canonical substring so this asserts deletion, not just the
    // absence of the original raw string.
    await expect(page.getByText(/heinz baked beans/i)).toBeHidden();
  });

  test('item edit sheet — update raw text and notes', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Create first list
    await page.goto('/#/shopping');
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
    await page.getByTestId('shopping-create-list-name').fill('Test list');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(/#\/shopping\/[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // Add an item
    await page.getByTestId('shopping-item-input').fill('pasta');
    await page.getByTestId('shopping-item-add-btn').click();

    const itemRow = page.getByTestId('shopping-item-row').filter({ hasText: 'pasta' });
    await expect(itemRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Open edit sheet
    await itemRow.getByTestId('shopping-item-edit-btn').click();

    await expect(page.getByTestId('shopping-edit-rawtext')).toBeVisible();
    await page.getByTestId('shopping-edit-rawtext').fill('penne pasta');
    await page.getByTestId('shopping-edit-notes').fill('500g bag');
    await page.getByTestId('shopping-edit-save').click();

    // Updated text should be visible in the list
    await expect(page.getByText('penne pasta')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('500g bag')).toBeVisible({ timeout: SYNC_TIMEOUT });
  });

  test('duplicate direct entries render as separate rows (no canon collapsing)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Seed an aisle and a canon item so any future-matched dupes share a canonId.
    await page.goto('/');
    await waitForBridge(page);

    const [dairyAisle] = await page.evaluate(() => window.__e2e!.seedAisles(['Dairy']));
    const milkCanon = await page.evaluate(
      ([aisleId]) => window.__e2e!.seedCanonItem({ name: 'Milk', aisleId }),
      [dairyAisle!.id] as const,
    );

    await page.goto('/#/shopping');
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
    await page.getByTestId('shopping-create-list-name').fill('Weekly');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(/#\/shopping\/[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // Add two items that would both resolve to Milk if the match trigger were running.
    // Without the trigger they stay in Needs Review; either way each must render as
    // its own row — direct entries are never collapsed.
    await page.getByTestId('shopping-item-input').fill('semi-skimmed milk');
    await page.getByTestId('shopping-item-add-btn').click();
    await page.getByTestId('shopping-item-input').fill('whole milk');
    await page.getByTestId('shopping-item-add-btn').click();

    const other = page.getByTestId('shopping-other');
    await expect(other).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByText('semi-skimmed milk')).toBeVisible();
    await expect(other.getByText('whole milk')).toBeVisible();
    await expect(other.getByTestId('shopping-item-edit-btn')).toHaveCount(2);

    expect(milkCanon.id).toBeTruthy();
  });
});
