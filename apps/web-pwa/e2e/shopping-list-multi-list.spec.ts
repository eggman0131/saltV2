/**
 * Shopping list multi-list E2E tests.
 *
 * Exercises: creating a second list, moving items between lists, verifying
 * the default list cannot be deleted (blocked, not gated behind a dialog),
 * and verifying that activeListId survives a page reload via the URL.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail, waitForBridge } from './helpers/auth';
import {
  getShoppingListItems,
  seedAisles,
  seedCanonItem,
  seedShoppingListBeforeBoot,
} from './helpers/seed';
import { SYNC_TIMEOUT, TRIGGER_TIMEOUT } from './helpers/timeouts';

// Wait for the onShoppingListItemWrite trigger to identify `rawText`, and return
// the canonId it settled on (issue #699). Read through the bridge inside a poll
// rather than off the DOM, which renders an optimistic pending row first
// (NF-E2). The caller seeds canon that resolves by exact name, so the match is a
// stage-1 direct hit with no AI branch (NF-E3).
async function waitForMatched(
  page: import('@playwright/test').Page,
  rawText: string,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const items = await getShoppingListItems(page);
        return items.find((i) => i.rawText === rawText)?.matchState ?? null;
      },
      { timeout: TRIGGER_TIMEOUT },
    )
    .toBe('matched');
  const matched = (await getShoppingListItems(page)).find((i) => i.rawText === rawText);
  return matched!.canonId!;
}

// Assert the item arrived on the destination list still carrying the identity it
// had before the move — the whole point of #699. `toPass` because the
// destination's snapshot has to land first.
async function expectMatchPreserved(
  page: import('@playwright/test').Page,
  rawText: string,
  canonId: string,
): Promise<void> {
  await expect(async () => {
    const moved = (await getShoppingListItems(page)).find((i) => i.rawText === rawText);
    expect(moved, `"${rawText}" should be on the destination list`).toBeTruthy();
    expect(moved!.canonId).toBe(canonId);
    expect(moved!.matchState).toBe('matched');
  }).toPass({ timeout: SYNC_TIMEOUT });
}

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

    // Seeded before boot rather than created through `createFirstList`: this test
    // asserts on which list is THE DEFAULT, and the default lives in
    // `shoppingListsConfig/singleton`, written only after the app has already
    // attached its listener to it — an update the emulator's forced long-polling
    // transport drops permanently often enough to dominate this test's CI
    // failures (`ctx_shopping_lists_count: 1` with `ctx_has_default_list: false`
    // on every recorded one). See `seedShoppingListBeforeBoot`. The other tests in
    // this file keep `createFirstList`, where creating a list IS the subject.
    const list = await seedShoppingListBeforeBoot('Weekly shop');

    await gotoAndSignIn(page, email);

    // No `/#/shopping/new` redirect to catch here — a default list already
    // exists, so `/#/shopping` bounces straight to it. Landing on that URL is
    // also the settle gate: it only resolves once the config snapshot arrives.
    await page.goto('/#/shopping');
    await expect(page).toHaveURL(new RegExp(`#/shopping/${list.id}$`), { timeout: SYNC_TIMEOUT });

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
    test.setTimeout(120_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Seed an aisle + a canon item the entry will match by exact name, so the
    // item is identified before the move and the move has an identity to keep
    // (issue #699). "Soy Sauce" and the entry "soy sauce" share a normalised
    // form → stage-1 direct hit, no AI (NF-E3).
    await page.goto('/');
    await waitForBridge(page);
    const [condiments] = await seedAisles(page, ['Condiments']);
    const soyCanon = await seedCanonItem(page, {
      name: 'Soy Sauce',
      aisleId: condiments!.id,
    });

    const firstListUrl = await createFirstList(page);

    // Add an item
    await page.getByTestId('shopping-item-input').fill('soy sauce');
    await page.getByTestId('shopping-item-add-btn').click();
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Let the trigger identify it before moving — otherwise the move would be
    // racing the very re-match this test asserts does not happen.
    const soyCanonId = await waitForMatched(page, 'soy sauce');
    expect(soyCanonId).toBe(soyCanon.id);

    // Create a second list
    await createSecondList(page, 'Asian supermarket');
    await expect(page).toHaveURL(/#\/shopping\/(?!lists)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const secondListUrl = page.url();

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

    // …and arrive on the destination already identified (issue #699). Before
    // this, the bulk move wrote canonId: null / matchState: 'pending' and the
    // row sat under OTHER with a spinner until the trigger re-ran.
    await page.goto(secondListUrl);
    await expectMatchPreserved(page, 'soy sauce', soyCanon.id);

    // Navigate via bridge to confirm which list is the default
    const defaultListId = await page.evaluate(() => window.__e2e!.getDefaultListId());
    expect(defaultListId).toBeTruthy();
  });

  test('edit sheet moves a single item, carrying the edits made in the same visit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Canon for the unchanged-text move at the end of this test (issue #699),
    // seeded by exact name so the match is a stage-1 direct hit with no AI
    // branch (NF-E3). Nothing here matches "soy sauce", so the edit-and-move
    // flow below behaves exactly as it did before.
    await page.goto('/');
    await waitForBridge(page);
    const [condiments] = await seedAisles(page, ['Condiments']);
    const vinegarCanon = await seedCanonItem(page, {
      name: 'Rice Vinegar',
      aisleId: condiments!.id,
    });

    const firstListUrl = await createFirstList(page);

    await page.getByTestId('shopping-item-input').fill('soy sauce');
    await page.getByTestId('shopping-item-add-btn').click();
    const soyRow = page.getByTestId('shopping-item-row').filter({ hasText: 'soy sauce' });
    await expect(soyRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // With one list there is nowhere to move to, so the picker is absent.
    await soyRow.getByTestId('shopping-item-edit-btn').click();
    await expect(page.getByTestId('shopping-edit-rawtext')).toBeVisible();
    await expect(page.getByTestId('shopping-edit-move-select')).toHaveCount(0);
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await createSecondList(page, 'Asian supermarket');
    const secondListUrl = page.url();
    await page.goto(firstListUrl);
    await expect(soyRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Arming a move and cancelling leaves the item where it was ─────────────
    await soyRow.getByTestId('shopping-item-edit-btn').click();
    await page.getByTestId('shopping-edit-move-select').click();
    await page.getByRole('option', { name: 'Asian supermarket' }).click();
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(soyRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Edit and move in the same visit ───────────────────────────────────────
    await soyRow.getByTestId('shopping-item-edit-btn').click();
    await page.getByTestId('shopping-edit-rawtext').fill('dark soy sauce');
    await page.getByTestId('shopping-edit-notes').fill('the thick one');
    await page.getByTestId('shopping-edit-move-select').click();
    await page.getByRole('option', { name: 'Asian supermarket' }).click();
    await page.getByTestId('shopping-edit-save').click();

    // Gone from the source…
    await expect(
      page.getByTestId('shopping-item-row').filter({ hasText: /soy sauce/i }),
    ).toHaveCount(0, { timeout: SYNC_TIMEOUT });

    // …and on the destination WITH the edits, not the originals. This is the
    // regression the composed single write exists to prevent.
    await page.goto(secondListUrl);
    await expect(page.getByText('dark soy sauce')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('the thick one')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Moving without editing the text keeps the item's identity (#699) ──────
    // The sheet always submits its text field, so this is the path where an
    // unconditional reset in editItemRawText would make a single-item move
    // diverge from the bulk move. Same seeded canon, same assertion.
    await page.goto(firstListUrl);
    await page.getByTestId('shopping-item-input').fill('rice vinegar');
    await page.getByTestId('shopping-item-add-btn').click();
    const vinegarRow = page.getByTestId('shopping-item-row').filter({ hasText: 'rice vinegar' });
    await expect(vinegarRow).toBeVisible({ timeout: SYNC_TIMEOUT });

    const vinegarCanonId = await waitForMatched(page, 'rice vinegar');
    expect(vinegarCanonId).toBe(vinegarCanon.id);

    await vinegarRow.getByTestId('shopping-item-edit-btn').click();
    // The text field is left exactly as it is — only the destination changes.
    await page.getByTestId('shopping-edit-move-select').click();
    await page.getByRole('option', { name: 'Asian supermarket' }).click();
    await page.getByTestId('shopping-edit-save').click();

    await page.goto(secondListUrl);
    await expectMatchPreserved(page, 'rice vinegar', vinegarCanon.id);
  });

  test('activeListId survives reload via URL', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // First list provides the "another list exists" precondition; we only assert
    // on the second below, so its URL is unused.
    await createFirstList(page);

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
    await expect(page).toHaveURL(secondListUrl, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });
  });
});
