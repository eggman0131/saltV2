/**
 * Recipe duplicate E2E (issue #735).
 *
 * Runs against the Firestore + Auth emulators with no AI on the assertion path.
 * Covers the whole user-visible contract of Duplicate: the ⋮ menu entry opens the
 * editor holding a full copy titled "X (copy)"; backing out writes nothing; and
 * saving yields a SECOND, independent recipe alongside the original.
 *
 * Deliberately left on the project's 1280x720 desktop default rather than pinned
 * to a phone the way `recipe-crud.spec.ts` is: the point of #735 is that the ⋮
 * menu now exists at every width, and running here is what pins that. Nothing
 * below asserts on the recipe page's column layout, so the desktop split is
 * irrelevant to it.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

const ORIGINAL = 'Duplicate Source Stew';
const COPY = `${ORIGINAL} (copy)`;
const INGREDIENT = '2 tbsp olive oil';
const STEP = 'Brown the beef in batches.';

test.describe('recipes — duplicate', () => {
  test('⋮ → Duplicate prefills the editor; save yields a second, independent recipe', async ({
    page,
  }, testInfo) => {
    // 90s: three full save round-trips through the emulator (create, abandoned
    // duplicate, saved duplicate), each gated on its own signal-bound wait below.
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── Seed: one recipe with an ingredient and a step, created through the UI ──
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill(ORIGINAL);

    await page.getByTestId('recipe-add-group-btn').click();
    // .nth(0) indexes the single group row THIS test just added — its own set,
    // not a global ordering.
    const group0 = page.getByTestId('recipe-group').nth(0);
    await group0.getByTestId('recipe-add-ingredient-btn').click();
    await group0.getByTestId('recipe-ingredient-input').nth(0).fill(INGREDIENT);

    await page.getByTestId('recipe-add-step-btn').click();
    await page.getByTestId('recipe-step-input').nth(0).fill(STEP);

    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const originalUrl = page.url();
    await expect(page.getByRole('heading', { name: ORIGINAL })).toBeVisible();

    // ── Duplicate → the editor opens holding a full copy ───────────────────────
    await page.getByTestId('recipe-actions-overflow').click();
    await page.getByTestId('recipe-duplicate-menu-item').click();

    await expect(page).toHaveURL(/#\/recipes\/new$/);
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await expect(page.getByTestId('recipe-title-input')).toHaveValue(COPY);
    // .nth(0) = the first ingredient / step of the copy this test just made —
    // the only one it authored, not a global index.
    await expect(page.getByTestId('recipe-ingredient-input').nth(0)).toHaveValue(INGREDIENT);
    await expect(page.getByTestId('recipe-step-input').nth(0)).toHaveValue(STEP);

    // ── Backing out writes nothing ─────────────────────────────────────────────
    await page.goto('/#/recipes');
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: ORIGINAL })).toHaveCount(
      1,
      {
        timeout: SYNC_TIMEOUT,
      },
    );
    // The abandoned copy left no document — asserted after the positive count
    // above has settled, so this is a real absence rather than an unrendered list.
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: COPY })).toHaveCount(0);

    // ── Duplicate again and save → two distinct recipes ────────────────────────
    await page.goto(`/#${originalUrl.split('#')[1]}`);
    await expect(page.getByRole('heading', { name: ORIGINAL })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await page.getByTestId('recipe-actions-overflow').click();
    await page.getByTestId('recipe-duplicate-menu-item').click();
    await expect(page.getByTestId('recipe-title-input')).toHaveValue(COPY);
    await page.getByTestId('recipe-save-btn').click();

    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    // A NEW document, not a rewrite of the original.
    expect(page.url()).not.toBe(originalUrl);
    await expect(page.getByRole('heading', { name: COPY })).toBeVisible();
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toContainText(INGREDIENT);
    await expect(page.getByTestId('recipe-view-step')).toHaveCount(1);

    // ── Both survive a reload: two independent Firestore documents ─────────────
    await page.goto('/#/recipes');
    await page.reload();
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: ORIGINAL })).toHaveCount(
      2,
      {
        timeout: SYNC_TIMEOUT,
      },
    );
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: COPY })).toHaveCount(1);

    // The original is untouched — still its own title, not the copy's.
    await page.goto(`/#${originalUrl.split('#')[1]}`);
    await expect(page.getByRole('heading', { name: ORIGINAL, exact: true })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
  });
});
