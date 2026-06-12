/**
 * Recipe manual CRUD E2E tests (issue #179, Phase 2).
 *
 * Runs against the Firestore + Auth emulators and exercises the full hand-entry
 * lifecycle with no AI: create a recipe with two ingredient groups and several
 * steps, persist, reload, edit, and delete. This is the schema stress-test the
 * phase is designed around.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';

const SYNC_TIMEOUT = 15_000;

test.describe('recipes — manual CRUD', () => {
  test('create with two groups + steps, reload, edit, delete', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── Create ─────────────────────────────────────────────────────────────
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();

    await page.getByTestId('recipe-title-input').fill('Test Dahl');

    // First group: named "For the dahl" with one ingredient.
    await page.getByTestId('recipe-add-group-btn').click();
    const group0 = page.getByTestId('recipe-group').nth(0);
    await group0.getByTestId('recipe-group-name-input').fill('For the dahl');
    await group0.getByTestId('recipe-add-ingredient-btn').click();
    await group0.getByTestId('recipe-ingredient-input').nth(0).fill('1 ½ cups red lentils, rinsed');

    // Second group: named "For the tarka".
    await page.getByTestId('recipe-add-group-btn').click();
    const group1 = page.getByTestId('recipe-group').nth(1);
    await group1.getByTestId('recipe-group-name-input').fill('For the tarka');
    await group1.getByTestId('recipe-add-ingredient-btn').click();
    await group1.getByTestId('recipe-ingredient-input').nth(0).fill('2 tbsp ghee');

    // Two steps.
    await page.getByTestId('recipe-add-step-btn').click();
    await page.getByTestId('recipe-step-input').nth(0).fill('Simmer the lentils until soft.');
    await page.getByTestId('recipe-add-step-btn').click();
    await page.getByTestId('recipe-step-input').nth(1).fill('Pour over the sizzling tarka.');

    await page.getByTestId('recipe-save-btn').click();

    // ── View page after save ─────────────────────────────────────────────────
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Test Dahl' })).toBeVisible();
    await expect(page.getByTestId('recipe-view-group-name')).toContainText([
      'For the dahl',
      'For the tarka',
    ]);
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toContainText(
      '1 ½ cups red lentils, rinsed',
    );
    await expect(page.getByTestId('recipe-view-step')).toHaveCount(2);

    const recipeUrl = page.url();

    // ── Reload → persisted ─────────────────────────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Test Dahl' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toContainText(
      '1 ½ cups red lentils, rinsed',
    );

    // ── Edit → change title, save ─────────────────────────────────────────────
    await page.getByTestId('recipe-edit-button').click();
    await expect(page.getByRole('heading', { name: /edit recipe/i })).toBeVisible();
    const titleInput = page.getByTestId('recipe-title-input');
    await titleInput.fill('Test Dahl (revised)');
    await page.getByTestId('recipe-save-btn').click();

    await expect(page).toHaveURL(new RegExp(`${recipeUrl.split('#')[1]}$`), {
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByRole('heading', { name: 'Test Dahl (revised)' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // ── Delete ───────────────────────────────────────────────────────────────
    await page.getByTestId('recipe-delete-button').click();
    await expect(page.getByTestId('recipe-delete-dialog')).toBeVisible();
    await page.getByTestId('recipe-delete-confirm').click();

    await expect(page).toHaveURL(/#\/recipes$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: 'Test Dahl' })).toHaveCount(
      0,
      { timeout: SYNC_TIMEOUT },
    );

    // Survives reload (delete committed to Firestore).
    await page.reload();
    await expect(page.getByTestId('recipe-list-item').filter({ hasText: 'Test Dahl' })).toHaveCount(
      0,
      { timeout: SYNC_TIMEOUT },
    );
  });
});
