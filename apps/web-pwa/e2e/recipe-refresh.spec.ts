/**
 * ⋮ → Refresh, through the review gate (issue #784).
 *
 * Refresh re-runs the librarian over a dish that already exists — no
 * conversation, no chat session, no transcript — and shows what it would change
 * in the same review sheet a chat amendment uses. Everything about it that a unit
 * test can pin is pinned in `apps/cloud-functions/tests/flows/authorRecipe.test.ts`
 * (the prompt composition) and `apps/web-pwa/tests/RecipeViewPage.refresh.test.ts`
 * (the wiring). What only e2e can show is that the whole chain actually runs:
 * a menu item with no conversation behind it reaching the real `authorRecipe`
 * callable, whose answer becomes a diff the user approves, whose approval becomes
 * a Firestore document.
 *
 * Runs against the Firestore + Auth emulators with the MODEL faked
 * (FUNCTIONS_AI_FAKE) and every other layer live — the callable boundary, the
 * Genkit flow, the Firestore write and the realtime subscription.
 *
 *   stubAi('authorRecipe', …)
 *     → ⋮ → Refresh runs the real authorRecipe callable in refresh mode
 *       → the diff proposes the re-transcription
 *         → Apply writes it / Discard leaves the dish alone
 *
 * Two tests, one per side of the gate, because "nothing is written until you say
 * so" is half of what Refresh promises and the half a happy path cannot show.
 *
 * No `parseRecipeIngredients` or canon stub, deliberately: the canned answer
 * repeats the seeded ingredient's rawText verbatim, and refresh mode grounds
 * `assembleRecipeDraft` on the base recipe exactly as edit mode does — so the
 * existing parse and canon match are reused and neither flow is called at all.
 * Stubbing a flow this journey never reaches would only suggest it does (NF-E1).
 *
 * Left on the project's 1280x720 desktop default. The ⋮ menu is the only surface
 * Refresh has at any width (#735), so there is no second surface to drive.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';
import type { Recipe } from '@salt/domain';
import type { Page } from '@playwright/test';

const DISH = 'Refresh Pilaf';
const INGREDIENT = '200 g chorizo, sliced';
const STEP = 'Fry the chorizo and add the rice and stir it through and cover.';
const TAG = 'refreshgate';

// The metadata the user typed. A refresh re-applies the WRITING rules; it has no
// business clearing what the cook entered, and the librarian's canned answer
// forgets all of it — so this doubles as the metadata-preserve assertion on the
// refresh path, which shares its merge with the chat path.
const SEEDED_METADATA = {
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 30,
  totalTimeMinutes: 45,
  tags: [TAG],
};

// The librarian's canned re-transcription: the run-on step is split in two (the
// one-operation rule), the title is tidied, and the metadata it was never given a
// reason to touch is DROPPED — null servings, null times, no tags.
const REFRESHED_TITLE = 'Chorizo Pilaf';
const REFRESHED_STEPS = ['Fry the chorizo.', 'Add the rice and stir it through, then cover.'];

const STUB_AUTHOR = {
  title: REFRESHED_TITLE,
  description: 'A one-pan chorizo pilaf.',
  servings: null,
  totalTimeMinutes: null,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  tags: [],
  ingredientGroups: [
    {
      name: null,
      ingredients: [{ rawText: INGREDIENT, isOptional: false, firstUsedInStepOrdinal: 0 }],
    },
  ],
  steps: REFRESHED_STEPS.map((text) => ({
    text,
    timerMinutes: null,
    timerLabel: null,
    note: null,
  })),
  notes: null,
};

async function getRecipes(page: Page): Promise<Recipe[]> {
  return page.evaluate<Recipe[]>(() => window.__e2e!.getRecipes() as Recipe[]);
}

async function titleOf(page: Page, recipeId: string): Promise<string | undefined> {
  return (await getRecipes(page)).find((r) => r.id === recipeId)?.title;
}

/** Creates the dish through the editor and returns its id. */
async function seedDish(page: Page): Promise<string> {
  await page.goto('/#/recipes/new');
  await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
  await page.getByTestId('recipe-title-input').fill(DISH);

  await page.getByTestId('recipe-servings-input').fill(String(SEEDED_METADATA.servings));
  await page.getByTestId('recipe-prep-input').fill(String(SEEDED_METADATA.prepTimeMinutes));
  await page.getByTestId('recipe-cook-input').fill(String(SEEDED_METADATA.cookTimeMinutes));
  await page.getByTestId('recipe-total-input').fill(String(SEEDED_METADATA.totalTimeMinutes));
  await page.getByTestId('recipe-tags-input').fill(TAG);
  await page.getByTestId('recipe-tags-input').press('Enter');

  await page.getByTestId('recipe-add-group-btn').click();
  // .nth(0) indexes the single group row THIS test just added — its own set.
  const group0 = page.getByTestId('recipe-group').nth(0);
  await group0.getByTestId('recipe-add-ingredient-btn').click();
  await group0.getByTestId('recipe-ingredient-input').nth(0).fill(INGREDIENT);

  await page.getByTestId('recipe-add-step-btn').click();
  await page.getByTestId('recipe-step-input').nth(0).fill(STEP);

  await page.getByTestId('recipe-save-btn').click();
  await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
  const id = page.url().match(/#\/recipes\/([a-z0-9-]+)/)?.[1];
  expect(id).toBeTruthy();

  await expect
    .poll(async () => (await getRecipes(page)).find((r) => r.id === id)?.metadata.servings, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe(SEEDED_METADATA.servings);
  return id!;
}

/**
 * ⋮ → Refresh, settled on the open review sheet.
 *
 * 60 s: this is a real callable round-trip through the emulator (cold function
 * start included), gated on the sheet appearing rather than on a clock.
 */
async function refreshAndReview(page: Page): Promise<void> {
  await page.getByTestId('recipe-actions-overflow').click();
  await page.getByTestId('recipe-refresh-menu-item').click();
  await expect(page.getByTestId('recipe-change-summary')).toBeVisible({ timeout: 60_000 });
  // The positive signal that the diff really computed and really saw the
  // re-transcription, before either test reads anything else off the sheet.
  await expect(page.getByTestId('recipe-change-group-basics')).toContainText(REFRESHED_TITLE);
}

test.describe('recipes — refresh through the review gate', () => {
  test('applies the re-transcription and keeps the metadata the librarian dropped', async ({
    page,
  }, testInfo) => {
    // 120s: a seed save plus a librarian round-trip through the emulator, each
    // gated on its own signal-bound wait.
    test.setTimeout(120_000);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId), '/', { admin: true });
    await page.evaluate((a) => window.__e2e!.stubAi('authorRecipe', a), STUB_AUTHOR);

    const recipeId = await seedDish(page);
    await refreshAndReview(page);

    // A refresh proposes no metadata change: the merge preserves what the
    // librarian omitted, so those groups are absent from the sheet entirely.
    await expect(page.getByTestId('recipe-change-group-metadata')).toHaveCount(0);
    await expect(page.getByTestId('recipe-change-group-tags')).toHaveCount(0);

    await page.getByTestId('recipe-change-apply').click();

    await expect
      .poll(() => titleOf(page, recipeId), { timeout: SYNC_TIMEOUT })
      .toBe(REFRESHED_TITLE);
    const saved = (await getRecipes(page)).find((r) => r.id === recipeId)!;
    // The run-on step came back as two, which is what a refresh is FOR.
    expect(saved.steps.map((s) => s.text)).toEqual(REFRESHED_STEPS);
    // And the cook's own numbers survived it.
    expect(saved.metadata).toEqual(SEEDED_METADATA);
  });

  test('discarding leaves the dish exactly as it was', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId), '/', { admin: true });
    await page.evaluate((a) => window.__e2e!.stubAi('authorRecipe', a), STUB_AUTHOR);

    const recipeId = await seedDish(page);
    await refreshAndReview(page);

    await page.getByTestId('recipe-change-discard').click();
    await expect(page.getByTestId('recipe-change-summary')).toBeHidden();

    // Steady state first: the store still holds the seeded dish (NF-A2).
    await expect.poll(() => titleOf(page, recipeId), { timeout: SYNC_TIMEOUT }).toBe(DISH);
    // Then a bounded hold on the NEGATIVE property "a discarded proposal is never
    // written" — a late save would land within this window, and the whole promise
    // of the gate is that there is no such save.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- NF-A2: bounded negative hold (a discarded proposal is never written)
    await page.waitForTimeout(2_000);
    const untouched = (await getRecipes(page)).find((r) => r.id === recipeId)!;
    expect(untouched.title).toBe(DISH);
    expect(untouched.steps.map((s) => s.text)).toEqual([STEP]);
    expect(untouched.metadata).toEqual(SEEDED_METADATA);
  });
});
