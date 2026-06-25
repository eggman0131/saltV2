/**
 * Recipe → shopping list E2E tests (issue #179, Phase 5).
 *
 * Exercises the "Add to shopping list" action from the recipe view against the
 * Firestore + Auth + Functions emulators. Ingredients are written as raw entries
 * (matchState: pending); the onShoppingListItemWrite trigger then canonicalises
 * each one (clean name + structured amount/unit), so the rendered rows — and the
 * assertions here — settle on the canonical name, not the raw recipe text. The
 * 'recipe' SourceRef survives that rewrite untouched (issue #320).
 *
 * Covers:
 * - Items from all ingredient groups reach the shopping list.
 * - Items carry the 'recipe' SourceRef with correct recipeId and servings.
 * - Servings selector defaults to recipe.metadata.servings; stepper adjusts it.
 * - A second "Add to list" appends more items (no deduplication — each call is
 *   its own row, matching existing shopping list behaviour).
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail, waitForBridge } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';
import type { ShoppingListItem } from '@salt/domain';

test.describe('recipe → shopping list extraction', () => {
  test('adds all ingredients from all groups and carries recipe source', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── Bootstrap: create the shopping list ──────────────────────────────────
    await page.goto('/#/shopping');
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
    await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
    await page.getByRole('button', { name: /create/i }).click();
    // Wait for the real list id (a UUID), not the `/shopping/new` create page —
    // `[a-z0-9-]+` would match "new" and let the test race ahead before the
    // create page's deferred push to the new list fires, yanking us off
    // /recipes/new mid-edit.
    await expect(page).toHaveURL(/#\/shopping\/[0-9a-f-]{36}$/, { timeout: SYNC_TIMEOUT });

    // ── Create a recipe with two ingredient groups (servings: 4) ─────────────
    await page.goto('/#/recipes/new');
    await page.getByTestId('recipe-title-input').fill('Test Pasta');
    await page.getByTestId('recipe-servings-input').fill('4');

    await page.getByTestId('recipe-add-group-btn').click();
    const group0 = page.getByTestId('recipe-group').nth(0);
    await group0.getByTestId('recipe-add-ingredient-btn').click();
    await group0.getByTestId('recipe-ingredient-input').nth(0).fill('400g spaghetti');
    await group0.getByTestId('recipe-add-ingredient-btn').click();
    await group0.getByTestId('recipe-ingredient-input').nth(1).fill('2 cloves garlic');

    await page.getByTestId('recipe-add-group-btn').click();
    const group1 = page.getByTestId('recipe-group').nth(1);
    await group1.getByTestId('recipe-group-name-input').fill('For the sauce');
    await group1.getByTestId('recipe-add-ingredient-btn').click();
    await group1.getByTestId('recipe-ingredient-input').nth(0).fill('100ml double cream');

    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    const recipeId = page.url().match(/#\/recipes\/([a-z0-9-]+)/)?.[1];
    expect(recipeId).toBeTruthy();

    // ── Open review sheet: default servings = 4, confirm ──────────────────────
    // Unmatched ingredients (no canon match in the client store) default to
    // add: true, so all three rows are included; the button reads "Add 3 to list".
    await page.getByTestId('recipe-add-to-list-button').click();
    await expect(page.getByTestId('recipe-add-review-list')).toBeVisible();
    await expect(page.getByTestId('recipe-servings-value')).toContainText('4');

    await page.getByTestId('recipe-add-to-list-confirm').click();
    await expect(page.getByTestId('recipe-add-review-list')).not.toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByText(/added \d+ items? to the list/i)).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // ── Navigate to shopping list and verify all three items appear ───────────
    await page.goto('/#/shopping');
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // The onShoppingListItemWrite trigger canonicalises each entry asynchronously
    // ("400g spaghetti" → name "spaghetti" + amount 400 / unit "g"), so the
    // rendered row settles on the canonical name, not the raw recipe string.
    // Assert the canonical name — which is also a substring of the raw entry, so
    // the check holds whether or not it races the async rewrite. The old literal
    // assertions only passed while the canon CF path was inert in e2e (before
    // #297, which wired the fake-model seam + GEMINI_API_KEY); see issue #320.
    await expect(page.getByText('spaghetti')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('cloves garlic')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('double cream')).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Verify 'recipe' SourceRef on each item via the in-page store ──────────
    await waitForBridge(page);
    const storeItems = await page.evaluate<ShoppingListItem[]>(
      () => window.__e2e!.getShoppingListItems() as ShoppingListItem[],
    );

    const fromRecipe = storeItems.filter((item) => item.sources.some((s) => s.kind === 'recipe'));
    expect(fromRecipe).toHaveLength(3);

    for (const item of fromRecipe) {
      const src = item.sources.find((s) => s.kind === 'recipe') as {
        kind: 'recipe';
        recipeId: string;
        servings: number;
      };
      expect(src.recipeId).toBe(recipeId);
      expect(src.servings).toBe(4);
    }
  });

  test('servings selector: defaults to recipe servings, stepper adjusts saved value', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // Bootstrap shopping list.
    await page.goto('/#/shopping');
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
    await page.getByTestId('shopping-create-list-name').fill('Test list');
    await page.getByRole('button', { name: /create/i }).click();
    // Wait for the real list id (a UUID), not the `/shopping/new` create page —
    // see the note in the first test: a permissive `[a-z0-9-]+` matches "new"
    // and lets the deferred push race the recipe navigation.
    await expect(page).toHaveURL(/#\/shopping\/[0-9a-f-]{36}$/, { timeout: SYNC_TIMEOUT });

    // Create a recipe with servings: 2.
    await page.goto('/#/recipes/new');
    await page.getByTestId('recipe-title-input').fill('Quick Recipe');
    await page.getByTestId('recipe-servings-input').fill('2');
    await page.getByTestId('recipe-add-group-btn').click();
    const group0 = page.getByTestId('recipe-group').nth(0);
    await group0.getByTestId('recipe-add-ingredient-btn').click();
    await group0.getByTestId('recipe-ingredient-input').nth(0).fill('1 onion');
    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // Open review sheet: default should be 2.
    await page.getByTestId('recipe-add-to-list-button').click();
    await expect(page.getByTestId('recipe-add-review-list')).toBeVisible();
    await expect(page.getByTestId('recipe-servings-value')).toContainText('2');

    // Decrease to 1 — then the button should be disabled.
    await page.getByTestId('recipe-servings-decrease').click();
    await expect(page.getByTestId('recipe-servings-value')).toContainText('1');
    await expect(page.getByTestId('recipe-servings-decrease')).toBeDisabled();

    // Increase to 6.
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('recipe-servings-increase').click();
    }
    await expect(page.getByTestId('recipe-servings-value')).toContainText('6');

    await page.getByTestId('recipe-add-to-list-confirm').click();
    await expect(page.getByText(/added \d+ items? to the list/i)).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Verify SourceRef.servings = 6 via the shopping list store.
    await page.goto('/#/shopping');
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByText('1 onion')).toBeVisible({ timeout: SYNC_TIMEOUT });

    await waitForBridge(page);
    const storeItems = await page.evaluate<ShoppingListItem[]>(
      () => window.__e2e!.getShoppingListItems() as ShoppingListItem[],
    );

    const recipeItems = storeItems.filter((item) => item.sources.some((s) => s.kind === 'recipe'));
    expect(recipeItems).toHaveLength(1);

    const src = recipeItems[0]!.sources.find((s) => s.kind === 'recipe') as {
      servings: number;
    };
    expect(src.servings).toBe(6);
  });
});
