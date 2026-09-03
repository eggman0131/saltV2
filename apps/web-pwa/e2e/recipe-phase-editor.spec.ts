/**
 * Hand-editing a recipe's phase strip, in a real browser (issue #1212).
 *
 * One journey, because the phase has one promise the model cannot keep for the
 * cook: what you type into the editor is what the recipe page draws, and it is
 * still there when you come back. That is a claim about a ROUND TRIP — editor →
 * `persistRecipe` → Firestore → the realtime subscription → the timeline — and
 * every jsdom test of it stops at the first arrow.
 *
 * It is the sibling of `recipe-phase-timeline.spec.ts`, which seeds its strips
 * through the bridge because until this phase there was no editor to type one
 * into. This spec deliberately uses no bridge seeding at all: the editor IS the
 * seam under test.
 *
 * As that spec's header explains, an e2e build has no PostHog key, so
 * `isObservabilityFeatureEnabled` reads every gate as ON and a key-OFF assertion
 * is impossible here by design — the edit page's three Prep / Cook / Total boxes
 * with the key off are pinned in `tests/RecipeEditPage.phases.test.ts` instead.
 * What this spec CAN assert about the gate is the on-state half: with the key on
 * those three boxes are not on the page.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';
import type { Page } from '@playwright/test';

// A phone, as `recipe-phase-timeline.spec.ts` pins: the recipe page docks its
// chat column from 700x480 up and this spec would otherwise inherit the
// project's desktop default.
test.use({ viewport: { width: 393, height: 851 } });

const DISH = 'Hand Edited Loaf';

interface PhaseInput {
  readonly label: string;
  readonly handsOn: string;
  readonly handsOff: string;
}

const TYPED: readonly PhaseInput[] = [
  { label: 'Mix and knead', handsOn: '20', handsOff: '0' },
  { label: 'Prove overnight', handsOn: '0', handsOff: '90' },
  { label: 'Shape and bake', handsOn: '10', handsOff: '30' },
];

// NF-B3: `nth` throughout this spec indexes the phase rows THIS test just added,
// in the order it added them — the order is the thing under test, so positional
// addressing is the point rather than a dodge. The rows carry no accessible name
// of their own (three identically-labelled fields per row), and the legend's
// `> li` / `> div` scoping is the same one `recipe-phase-timeline.spec.ts` uses.

/** Fill row `index` of the phase editor — the label and both minute figures. */
async function fillPhase(page: Page, index: number, phase: PhaseInput): Promise<void> {
  await page.getByTestId('recipe-phase-label-input').nth(index).fill(phase.label);
  await page.getByTestId('recipe-phase-hands-on-input').nth(index).fill(phase.handsOn);
  await page.getByTestId('recipe-phase-hands-off-input').nth(index).fill(phase.handsOff);
}

/** The legend's rows, in the order the strip draws them. */
function legendRows(page: Page) {
  return page.getByTestId('recipe-phase-legend').locator('> li');
}

test.describe('recipes — hand-editing the phase strip', () => {
  test('what the cook types is what the timeline draws, and it survives a reload', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── Author a recipe, timing it by hand ───────────────────────────────────
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill(DISH);

    // The strip is the only way to time a recipe: the three number boxes it
    // replaced were deleted with the fields behind them (#1213).
    await expect(page.getByTestId('recipe-phase-editor')).toBeVisible();
    await expect(page.getByTestId('recipe-prep-input')).toHaveCount(0);
    await expect(page.getByTestId('recipe-cook-input')).toHaveCount(0);
    await expect(page.getByTestId('recipe-total-input')).toHaveCount(0);

    for (let i = 0; i < TYPED.length; i += 1) {
      await page.getByTestId('recipe-add-phase-btn').click();
      await fillPhase(page, i, TYPED[i]!);
    }
    await expect(page.getByTestId('recipe-phase')).toHaveCount(3);

    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const id = page.url().match(/#\/recipes\/([a-z0-9-]+)/)?.[1];
    expect(id).toBeTruthy();

    // ── The recipe page draws exactly that strip ─────────────────────────────
    await expect(page.getByTestId('recipe-phases')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(legendRows(page)).toHaveCount(3);
    await expect(page.getByTestId('recipe-phase-timeline-bar').locator('> div')).toHaveCount(3);
    for (const phase of TYPED) {
      await expect(page.getByTestId('recipe-phase-legend')).toContainText(phase.label);
    }

    // ── It reads back into the editor, from Firestore, after a full reload ────
    await page.goto(`/#/recipes/${id}/edit`);
    await page.reload();
    await expect(page.getByTestId('recipe-phase')).toHaveCount(3, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('recipe-phase-label-input').nth(1)).toHaveValue(
      'Prove overnight',
    );
    await expect(page.getByTestId('recipe-phase-hands-off-input').nth(1)).toHaveValue('90');

    // ── Correct it: reorder, rename, retime, delete ──────────────────────────
    await page.getByLabel('Move phase up').nth(2).click();
    await page.getByTestId('recipe-phase-label-input').nth(0).fill('Mix, knead and rest');
    await page.getByTestId('recipe-phase-hands-on-input').nth(0).fill('25');
    await page.getByLabel('Remove phase').nth(2).click();
    await expect(page.getByTestId('recipe-phase')).toHaveCount(2);

    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(new RegExp(`#/recipes/${id}$`), { timeout: SYNC_TIMEOUT });

    await expect(legendRows(page)).toHaveCount(2, { timeout: SYNC_TIMEOUT });
    await expect(legendRows(page).nth(0)).toContainText('Mix, knead and rest');
    await expect(legendRows(page).nth(1)).toContainText('Shape and bake');
    await expect(page.getByTestId('recipe-phase-legend')).not.toContainText('Prove overnight');
  });
});
