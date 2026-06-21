/**
 * AI fake-model seam smoke test (test-infra Phase 1).
 *
 * Proves the cross-process stub seam round-trips end to end:
 *
 *   stubAi() writes `_e2e_ai_stubs/{flow}` to the shared emulator Firestore
 *     → the equipment capture UI calls the REAL populateEquipmentEntry callable
 *       → the CF runs the REAL flow, but under FUNCTIONS_AI_FAKE=1 its Genkit
 *         *model* is the deterministic fake, which reads the stub doc
 *         → the flow returns the stubbed answer through the unchanged callable
 *           → the UI renders the stubbed accessories and saves the manifest
 *             → the manifest (with the stubbed accessory) lands in the store.
 *
 * Only the model output is faked: the callable boundary, the Genkit flow, the
 * Firestore write, and the realtime store subscription are all the production
 * code paths. This is the seam phases 2–6 build on; see fakeModel.ts for the
 * keying/storage contract.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';

const SYNC_TIMEOUT = 15_000;

// A make-believe accessory a real Gemini key would never return for this input —
// so its presence in the UI/store can only have come from the stub.
const STUB_ACCESSORY = 'Deterministic Stub Whisk';

test.describe('AI fake-model seam — stubAi round-trip', () => {
  test('a stubbed populateEquipmentEntry answer reaches the store via the real callable', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // Register the canned model answer BEFORE invoking the flow. Shape must
    // satisfy PopulateEquipmentEntryAIOutputSchema ({ name, accessories[] }).
    await page.evaluate(
      ({ accessory }) =>
        window.__e2e!.stubAi('populateEquipmentEntry', {
          name: 'Stubbed Stand Mixer',
          accessories: [{ name: accessory, included: true }],
        }),
      { accessory: STUB_ACCESSORY },
    );

    // ── Drive the capture flow to the point it calls the real callable ──
    await page.goto('/#/equipment/new');
    await expect(page.getByRole('heading', { name: /add equipment/i })).toBeVisible();

    await page.getByTestId('equipment-raw-name-input').fill('Stand Mixer');
    await page.getByRole('button', { name: /identify/i }).click();

    await expect(page.getByRole('heading', { name: /confirm name/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId('equipment-confirmed-name-input').fill('My Stand Mixer');

    // Confirm → calls the real populateEquipmentEntry callable, whose model is
    // the fake reading our stub. The stubbed accessory must render in step 3.
    await page.getByTestId('equipment-confirm-name-btn').click();

    await expect(
      page.getByTestId('equipment-draft-accessory').filter({ hasText: STUB_ACCESSORY }),
    ).toBeVisible({ timeout: 30_000 });

    // ── Save, then assert it round-trips into the store ──
    await page.getByTestId('equipment-save-btn').click();

    await expect(page).toHaveURL(/#\/equipment\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // The faked AI accessory is now persisted in the equipment manifest store.
    const manifest = await page.evaluate(() => window.__e2e!.getEquipmentManifest());
    const accessoryNames = manifest?.items.flatMap((i) => i.accessories.map((a) => a.name)) ?? [];
    expect(accessoryNames).toContain(STUB_ACCESSORY);
  });
});
