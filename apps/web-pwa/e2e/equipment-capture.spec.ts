/**
 * Equipment capture + edit E2E tests.
 *
 * These tests run against the Firestore + Auth emulators and exercise the
 * full equipment manifest lifecycle: capture flow, rule authoring, and
 * persistence across reload.
 *
 * AI callables (identifyEquipment / populateEquipmentEntry) may fail in the
 * emulator if GEMINI_API_KEY is not set in .secret.local. Both the capture
 * flow UI and these tests are designed to work correctly in that case: the
 * test skips the AI candidate selection and confirms a name manually.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';

const SYNC_TIMEOUT = 15_000;

test.describe('equipment — capture, edit, and persistence', () => {
  test('capture a device end-to-end, author a rule, reload, see it persisted', async ({
    page,
  }, testInfo) => {
    // Two AI calls (identifyEquipment + populateEquipmentEntry) plus several
    // sync waits push this well past the 30s default.
    test.setTimeout(120_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // ── Step 1: raw name ──────────────────────────────────────────────────
    await page.goto('/#/equipment/new');
    await expect(page.getByRole('heading', { name: /add equipment/i })).toBeVisible();

    const rawInput = page.getByTestId('equipment-raw-name-input');
    await rawInput.fill('KitchenAid Stand Mixer');

    // Submit step 1 (identify). AI may fail — we proceed regardless.
    await page.getByRole('button', { name: /identify/i }).click();

    // ── Step 2: confirm name ──────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /confirm name/i })).toBeVisible({
      timeout: 10_000,
    });

    // Type the confirmed name (works whether or not AI returned candidates).
    const confirmedInput = page.getByTestId('equipment-confirmed-name-input');
    await confirmedInput.fill('KitchenAid Artisan Stand Mixer');

    await page.getByTestId('equipment-confirm-name-btn').click();

    // ── Step 3: accessories ───────────────────────────────────────────────
    // The Confirm click triggers populateEquipmentEntry (AI), which can take
    // 15s+ end-to-end against a real Gemini key. Give it generous time.
    await expect(
      page.getByRole('heading', { name: /kitchenaid artisan stand mixer/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Add a manual accessory.
    const accessoryInput = page.getByTestId('equipment-new-accessory-input');
    await accessoryInput.fill('QA Test Whisk');
    await page.getByRole('button', { name: /^add$/i }).click();
    await expect(
      page.getByTestId('equipment-draft-accessory').filter({ hasText: 'QA Test Whisk' }),
    ).toBeVisible();

    // Save.
    await page.getByTestId('equipment-save-btn').click();

    // ── Edit page: navigate to newly created item ─────────────────────────
    await expect(page).toHaveURL(/#\/equipment\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(
      page.getByRole('heading', { name: /kitchenaid artisan stand mixer/i }),
    ).toBeVisible();

    // Verify accessory is present.
    await expect(
      page.getByTestId('equipment-accessories').getByText('QA Test Whisk'),
    ).toBeVisible();

    // Wait for the "Added X" success toast to dismiss before clicking
    // controls in the bottom-right, where the toast viewport overlays.
    // The Toast auto-dismiss timer pauses on mouseenter — move the cursor
    // away from the bottom-right corner so the 5s timer can run.
    await page.mouse.move(0, 0);
    await expect(page.getByText(/added kitchenaid artisan stand mixer/i)).toBeHidden({
      timeout: SYNC_TIMEOUT,
    });

    // ── Author a rule ─────────────────────────────────────────────────────
    const ruleInput = page.getByTestId('equipment-add-rule-input');
    await ruleInput.fill('Use slow speed (1–2) for bread dough');
    await page.getByTestId('equipment-add-rule-btn').click();

    await expect(
      page.getByTestId('equipment-rules').getByTestId('equipment-rule-text').first(),
    ).toHaveText('Use slow speed (1–2) for bread dough', { timeout: SYNC_TIMEOUT });

    // ── Reload and verify persistence ─────────────────────────────────────
    const currentUrl = page.url();
    await page.reload();
    await page.goto(currentUrl);

    // Wait for subscription to hydrate.
    await expect(
      page.getByRole('heading', { name: /kitchenaid artisan stand mixer/i }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });

    await expect(
      page.getByTestId('equipment-accessories').getByText('QA Test Whisk'),
    ).toBeVisible();

    await expect(
      page.getByTestId('equipment-rules').getByTestId('equipment-rule-text').first(),
    ).toHaveText('Use slow speed (1–2) for bread dough');
  });

  test('equipment item appears in list page after capture', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Seed manifest via bridge for a fast, AI-free path.
    await page.evaluate(() =>
      window.__e2e!.seedEquipmentManifest({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: 'test-mixer',
            schemaVersion: 1,
            name: 'Stand Mixer',
            accessories: [],
            rules: [],
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    await page.goto('/#/equipment');
    await expect(
      page
        .getByTestId('equipment-list')
        .getByTestId('equipment-list-item')
        .filter({ hasText: 'Stand Mixer' }),
    ).toBeVisible({ timeout: SYNC_TIMEOUT });
  });

  test('delete equipment item removes it from the list', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    await page.evaluate(() =>
      window.__e2e!.seedEquipmentManifest({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: 'to-delete',
            schemaVersion: 1,
            name: 'Old Blender',
            accessories: [],
            rules: [],
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    await page.goto('/#/equipment');

    // Select the row via its checkbox (bulk-delete UI), then trigger the
    // selection-bar Delete and confirm in the dialog.
    const row = page
      .getByTestId('equipment-list')
      .locator('li')
      .filter({ has: page.locator('[data-equipment-id="to-delete"]') });
    await row.getByRole('checkbox').click();

    await page.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByTestId('equipment-delete-dialog')).toBeVisible();
    await page.getByTestId('equipment-delete-confirm').click();

    await expect(
      page
        .getByTestId('equipment-list')
        .getByTestId('equipment-list-item')
        .filter({ hasText: 'Old Blender' }),
    ).not.toBeVisible({ timeout: SYNC_TIMEOUT });
  });
});
