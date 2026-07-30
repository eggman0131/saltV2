/**
 * "When you CBA" — outings end to end (issue #637, Phase 3).
 *
 * An outing is a takeaway, a picnic, a meal out or a fend-for-yourself night: it
 * fills a planner slot but has no ingredients and no method. This walks the one
 * journey that has to work — New → When you CBA → title + description → save —
 * and then pins the two halves of the promise the UI makes about it: the entry
 * lives under its OWN section (and is absent from the default Recipes view), and
 * its page offers nothing that does not apply to it.
 *
 * No AI stub is needed. Creating an entry fires the `onRecipeWritten` hero-image
 * trigger, but nothing asserted here depends on that trigger's output — the same
 * reason recipe-crud.spec.ts does not stub either.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

const OUTING_TITLE = 'Takeaway — Indian';
const RECIPE_TITLE = 'Reference Recipe';

test.describe('recipes — when you CBA', () => {
  test('create an outing, find it under its own section, and not among the recipes', async ({
    page,
  }, testInfo) => {
    // Single-tab, no cross-tab convergence and no AI wait: the 60 s budget is the
    // single-tab tier (NF-F2). Every wait below is bound to a real signal.
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── A recipe to be distinguished FROM ────────────────────────────────────
    // Seeded through the editor rather than the bridge so both entries take the
    // identical path — the only difference between them is the kind, which is
    // exactly what the section assertions are about.
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
    await page.getByLabel('Title').fill(RECIPE_TITLE);
    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // ── Create the outing from the New menu ──────────────────────────────────
    await page.goto('/#/recipes');
    await page.getByTestId('recipe-new-btn').click();
    await page.getByTestId('recipe-new-outing').click();

    await expect(page).toHaveURL(/#\/recipes\/new\/outing$/);
    await expect(page.getByRole('heading', { name: 'New — When you CBA' })).toBeVisible();

    // Title and description are the whole form. Nothing that does not apply is
    // offered — no ingredients, no method, no cooking times.
    await expect(page.getByText('Ingredients', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Method', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Servings')).toHaveCount(0);
    await expect(page.getByLabel('Total (min)')).toHaveCount(0);

    await page.getByLabel('Title').fill(OUTING_TITLE);
    await page.getByLabel('Description').fill('Curry from the place on the corner.');
    await page.getByTestId('recipe-save-btn').click();

    // ── Its page offers only what applies ────────────────────────────────────
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByRole('heading', { name: OUTING_TITLE })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByText('Curry from the place on the corner.')).toBeVisible();

    await expect(page.getByTestId('recipe-cook-button')).toHaveCount(0);
    await expect(page.getByTestId('recipe-add-to-list-button')).toHaveCount(0);
    await expect(page.getByText('Ingredients', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Method', { exact: true })).toHaveCount(0);
    // Edit and Delete always apply, so the header is never left bare.
    await expect(page.getByTestId('recipe-edit-button')).toBeVisible();

    // ── Sections ─────────────────────────────────────────────────────────────
    await page.goto('/#/recipes');
    const cards = page.getByTestId('recipe-list-item');
    const sections = page.getByTestId('recipe-kind-filters');

    // The default view is unchanged: recipes, and only recipes.
    await expect(cards.filter({ hasText: RECIPE_TITLE })).toHaveCount(1, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(cards.filter({ hasText: OUTING_TITLE })).toHaveCount(0);

    // Switching sections swaps one for the other.
    await sections.getByRole('button', { name: 'When you CBA' }).click();
    await expect(cards.filter({ hasText: OUTING_TITLE })).toHaveCount(1);
    await expect(cards.filter({ hasText: RECIPE_TITLE })).toHaveCount(0);

    // And the section survives a reload back onto the default, which is what
    // makes "Recipes looks the same as today" true for anyone who never opens
    // the other section.
    await page.reload();
    await expect(cards.filter({ hasText: RECIPE_TITLE })).toHaveCount(1, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(cards.filter({ hasText: OUTING_TITLE })).toHaveCount(0);
  });
});
