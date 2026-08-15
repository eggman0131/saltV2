/**
 * Building a meal out of NEW dishes (issue #752, Phase 3).
 *
 * A meal is an ordinary `recipes/{id}` carrying `componentRecipeIds`. Phase 1 let
 * you attach dishes that already exist; Phase 3 lets you make one that doesn't —
 * from the meal, by any of the four routes into a recipe — and have it come back
 * attached.
 *
 * This spec drives the BY-HAND route end to end, and only that one. The other
 * three (import a link, photograph a page, chat one up) end in exactly the same
 * place — an editor at `/recipes/{id}/edit?meal=…`, or the chat page's save — and
 * differ only in what makes the recipe, which is an AI call each. Their landing
 * is covered by unit tests; what needs a real browser is the round trip itself.
 *
 * What the round trip actually rests on is the QUERYSTRING: the meal's id lives
 * in the URL and nowhere else, so the assertions below check the address bar at
 * each hop as deliberately as they check the outcome. A reload in the middle is
 * part of the journey for the same reason — module state would not survive it,
 * and that is the class of bug this phase exists to avoid.
 *
 * The meal and its first dish are bridge-seeded (NF-C4): authoring them through
 * the editor is two round trips plus the "Made from" picker before the thing
 * under test begins, and none of that is what this journey is about. No AI stub
 * is needed — nothing here calls a flow, and the `onRecipeWritten` hero trigger
 * short-circuits under `FUNCTIONS_AI_FAKE` regardless.
 */
import type { Page } from '@playwright/test';
import type { Recipe } from '@salt/domain';
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { seedRecipe } from './helpers/seed';
import { SYNC_TIMEOUT } from './helpers/timeouts';

// A phone, pinned explicitly (#696, Phase 4): the recipe page docks its chat
// column from 700x480 up, and this spec would otherwise inherit the project's
// 1280x720 desktop default. Same numbers as `recipe-crud.spec.ts`.
test.use({ viewport: { width: 393, height: 851 } });

const MEAL_ID = 'meal-roast';
const CHICKEN_ID = 'meal-chicken';
const NEW_DISH = 'Onion gravy';

function recipe(id: string, title: string, componentRecipeIds: string[] = []): Recipe {
  return {
    id,
    schemaVersion: 1,
    kind: 'recipe',
    title,
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: 4,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    componentRecipeIds,
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The meal's component ids, read from the store rather than the DOM (NF-D3). */
function readComponents(page: Page): Promise<string[]> {
  return page.evaluate((id) => {
    const meal = window.__e2e!.getRecipes().find((r) => r.id === id);
    return [...(meal?.componentRecipeIds ?? [])];
  }, MEAL_ID);
}

test.describe('meals — a dish written for the meal comes back attached', () => {
  test('by hand: from the meal, into the editor, and back onto the meal', async ({
    page,
  }, testInfo) => {
    // Two seeded recipes, one authored, one whole-document write on top — the
    // create-and-edit tier (NF-F2), not the trigger/AI one.
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // A meal: an ordinary recipe that already has one dish hanging off it. The
    // component is what makes the "Made from" card — and so the New menu inside
    // it — exist at all; a recipe with nothing attached is not a meal yet.
    await seedRecipe(page, recipe(CHICKEN_ID, 'Roast chicken'));
    await seedRecipe(page, recipe(MEAL_ID, 'Sunday roast', [CHICKEN_ID]));

    await page.goto(`/#/recipes/${MEAL_ID}`);
    await expect(page.getByRole('heading', { name: 'Sunday roast' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId('recipe-component-card')).toHaveCount(1);

    // ── From the meal, start a dish by hand ──────────────────────────────────
    // The menu and its items are action affordances with no stable accessible
    // name of their own (NF-B2), so they are reached by testid.
    await page.getByTestId('meal-component-new-btn').click();
    await page.getByTestId('meal-component-new-manual').click();

    // THE mechanism: the meal rides the URL. Nothing else knows where this
    // editor came from, which is exactly why the next step can reload.
    await expect(page).toHaveURL(new RegExp(`#/recipes/new\\?meal=${MEAL_ID}$`));

    // ── Reload mid-flow: the return target survives ──────────────────────────
    // The point of the phase in one line. A module-level stash would be gone by
    // the time the editor came back.
    await page.reload();
    await expect(page.getByTestId('recipe-title-input')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`#/recipes/new\\?meal=${MEAL_ID}$`));

    // ── Write it and save ────────────────────────────────────────────────────
    await page.getByTestId('recipe-title-input').fill(NEW_DISH);
    await page.getByTestId('recipe-add-step-btn').click();
    await page.getByTestId('recipe-step-input').fill('Soften the onions, then thicken.');
    await page.getByTestId('recipe-save-btn').click();

    // ── Back on the meal, with the new dish attached ─────────────────────────
    await expect(page).toHaveURL(new RegExp(`#/recipes/${MEAL_ID}$`), { timeout: SYNC_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Sunday roast' })).toBeVisible();

    // The attach is a whole-document write settling asynchronously, so poll the
    // store (NF-A3/NF-D3). The chicken keeps its place — attaching adds, it never
    // re-sorts what was already arranged.
    await expect.poll(() => readComponents(page), { timeout: SYNC_TIMEOUT }).toHaveLength(2);
    const components = await readComponents(page);
    expect(components).toContain(CHICKEN_ID);

    // …and the card the user actually sees.
    await expect(page.getByTestId('recipe-component-card')).toHaveCount(2);
    await expect(
      page.getByTestId('recipe-component-card').filter({ hasText: NEW_DISH }),
    ).toBeVisible();

    // ── It is committed, not merely optimistic ───────────────────────────────
    await page.reload();
    await expect(
      page.getByTestId('recipe-component-card').filter({ hasText: NEW_DISH }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });
  });
});
