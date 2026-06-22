/**
 * Recipe ingredient parsing + canonicalisation E2E (issue #179 / test-infra Phase 2).
 *
 * Drives the AI-backed recipe path the existing recipe specs deliberately skip:
 *
 *   stubAi('parseRecipeIngredients', …) writes the canned model answer to the
 *     shared emulator Firestore
 *     → the editor's "Parse from text" calls the REAL parseRecipeIngredients
 *       callable, whose Genkit *model* is the deterministic fake under
 *       FUNCTIONS_AI_FAKE=1 (the seam from Phase 1; see fakeModel.ts)
 *       → the flow returns the stubbed structure (with IDs/matchState added)
 *         → the editor hydrates the ingredient groups and the recipe is saved
 *           → "Canonicalise" runs the REAL canonicaliseRecipeIngredients
 *             callable, which is deterministic rule-based matching: with canon
 *             items pre-seeded whose names equal the parsed `item`, every line
 *             resolves at the exact-name stage (no embeddings, no arbitration).
 *
 * Only the parse model output is faked; the callable boundaries, the flows, the
 * Firestore writes and the realtime store subscription are all production paths.
 *
 * Asserts the parsed/canonical structure in BOTH the recipe store (via the
 * window.__e2e.getRecipes bridge) and the rendered DOM, plus reload persistence.
 *
 * Complements recipe-crud.spec.ts and recipe-shopping-list.spec.ts, which stay
 * on the rawText/pending fallback and never touch the AI path.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { seedAisles, seedCanonItem, waitForCanonReady } from './helpers/seed';
import type { Recipe } from '@salt/domain';

const SYNC_TIMEOUT = 15_000;

// The canned answer the faked parseRecipeIngredients model returns. Shape must
// satisfy ParseRecipeIngredientsAIOutputSchema — the slim pre-ID AI shape: the
// flow adds ids/canonId/matchState afterwards. Quantities are metric (g/ml).
// The `item` values are chosen to equal the seeded canon item names exactly so
// canonicalisation resolves at the deterministic exact-name stage.
const STUB_PARSE = {
  groups: [
    {
      name: 'For the dahl',
      items: [
        {
          rawText: '1 ½ cups red lentils, rinsed',
          quantity: { type: 'single' as const, value: 300 },
          unit: 'g' as const,
          item: 'red lentils',
          preparation: ['rinsed'],
          notes: null,
          isOptional: false,
          displayText: '1 ½ cups',
        },
      ],
    },
    {
      name: 'For the tarka',
      items: [
        {
          rawText: '2 tbsp ghee',
          quantity: { type: 'single' as const, value: 28 },
          unit: 'g' as const,
          item: 'ghee',
          preparation: [],
          notes: null,
          isOptional: false,
          displayText: '2 tbsp',
        },
        {
          rawText: '2 cloves garlic, crushed',
          quantity: { type: 'single' as const, value: 6 },
          unit: 'g' as const,
          item: 'garlic',
          preparation: ['crushed'],
          notes: null,
          isOptional: false,
          displayText: '2 cloves',
        },
      ],
    },
  ],
};

// The raw text pasted into the editor. Its exact content is irrelevant under the
// stub (the fake model ignores the prompt and returns STUB_PARSE), but we feed a
// plausible list so the call surface matches production.
const PASTE_TEXT = [
  'For the dahl:',
  '1 ½ cups red lentils, rinsed',
  '',
  'For the tarka:',
  '2 tbsp ghee',
  '2 cloves garlic, crushed',
].join('\n');

test.describe('recipes — AI parse + canonicalise', () => {
  test('parses ingredients (stubbed AI), canonicalises against seeded canon, persists', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── Register the canned parse answer BEFORE driving the UI ───────────────
    await page.evaluate(
      (parse) => window.__e2e!.stubAi('parseRecipeIngredients', parse),
      STUB_PARSE,
    );

    // ── Seed canon so canonicalisation resolves deterministically ────────────
    // canonicaliseRecipeIngredients is rule-based: an exact normalised-name match
    // returns at stage 1 with no embedding/arbitration AI call. Each parsed
    // `item` has a canon item of the same name, so all three lines match.
    await seedAisles(page, ['Pulses', 'Dairy', 'Produce']);
    await waitForCanonReady(page);
    const lentilCanon = await seedCanonItem(page, { name: 'red lentils' });
    const gheeCanon = await seedCanonItem(page, { name: 'ghee' });
    const garlicCanon = await seedCanonItem(page, { name: 'garlic' });

    // ── Create a recipe and parse the pasted list via the AI callable ────────
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill('Parsed Dahl');

    await page.getByTestId('recipe-parse-toggle-btn').click();
    await expect(page.getByTestId('recipe-parse-area')).toBeVisible();
    await page.getByTestId('recipe-parse-text-input').fill(PASTE_TEXT);
    await page.getByTestId('recipe-parse-btn').click();

    // The editor hydrates the two stubbed groups + three ingredient rows.
    await expect(page.getByTestId('recipe-group')).toHaveCount(2, { timeout: 30_000 });
    const group0 = page.getByTestId('recipe-group').nth(0);
    const group1 = page.getByTestId('recipe-group').nth(1);
    await expect(group0.getByTestId('recipe-group-name-input')).toHaveValue('For the dahl');
    await expect(group1.getByTestId('recipe-group-name-input')).toHaveValue('For the tarka');
    // rawText is preserved verbatim through the parse.
    await expect(group0.getByTestId('recipe-ingredient-input').nth(0)).toHaveValue(
      '1 ½ cups red lentils, rinsed',
    );

    // ── Save → view page ─────────────────────────────────────────────────────
    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const recipeUrl = page.url();
    const recipeId = recipeUrl.match(/#\/recipes\/([a-z0-9-]+)/)?.[1];
    expect(recipeId).toBeTruthy();

    // ── The parsed structure renders weight-first with the displayText note ──
    // RecipeViewPage shows "<qty><unit> <item>, <prep> (<displayText>)".
    const dahlGroup = page.getByTestId('recipe-view-group').nth(0);
    await expect(dahlGroup.getByTestId('recipe-view-ingredient').nth(0)).toContainText(
      '300g red lentils, rinsed',
    );
    await expect(dahlGroup.getByTestId('recipe-view-ingredient').nth(0)).toContainText(
      '(1 ½ cups)',
    );

    // ── Assert the parsed structure landed in the recipe store ───────────────
    await page.waitForFunction(() => Boolean(window.__e2e), null, { timeout: 10_000 });
    const afterParse = await page.evaluate<Recipe[]>(() => window.__e2e!.getRecipes() as Recipe[]);
    const parsed = afterParse.find((r) => r.id === recipeId);
    expect(parsed).toBeTruthy();
    expect(parsed!.ingredients).toHaveLength(2);
    expect(parsed!.ingredients[0]!.name).toBe('For the dahl');
    expect(parsed!.ingredients[1]!.name).toBe('For the tarka');

    const lentil = parsed!.ingredients[0]!.items[0]!;
    expect(lentil.parsed).not.toBeNull();
    expect(lentil.parsed!.item).toBe('red lentils');
    expect(lentil.parsed!.unit).toBe('g');
    expect(lentil.parsed!.quantity).toEqual({ type: 'single', value: 300 });
    expect(lentil.parsed!.preparation).toEqual(['rinsed']);
    expect(lentil.parsed!.displayText).toBe('1 ½ cups');
    // Not yet canonicalised — parse leaves matchState pending with no canonId.
    expect(lentil.matchState).toBe('pending');
    expect(lentil.canonId).toBeNull();

    const garlic = parsed!.ingredients[1]!.items[1]!;
    expect(garlic.parsed!.item).toBe('garlic');
    expect(garlic.parsed!.quantity).toEqual({ type: 'single', value: 6 });

    // ── Canonicalise → every line matches its seeded canon item ──────────────
    await page.getByTestId('recipe-canonicalise-button').click();
    // Each matched ingredient drops its "not matched" (✗) affordance; once none
    // remain the Canonicalise button itself disappears (hasParsedPending false).
    await expect(page.getByTestId('recipe-canonicalise-button')).toBeHidden({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId('match-state-unmatched')).toHaveCount(0, {
      timeout: SYNC_TIMEOUT,
    });

    // ── Assert the canonical matches landed in the store ─────────────────────
    const expectedCanon = await page.evaluate<Recipe[]>(
      () => window.__e2e!.getRecipes() as Recipe[],
    );
    const matched = expectedCanon.find((r) => r.id === recipeId)!;
    const allItems = matched.ingredients.flatMap((g) => g.items);
    expect(allItems).toHaveLength(3);
    for (const ing of allItems) {
      expect(ing.matchState).toBe('matched');
      expect(ing.canonId).not.toBeNull();
    }
    const canonIdByItem = new Map(allItems.map((i) => [i.parsed!.item, i.canonId]));
    expect(canonIdByItem.get('red lentils')).toBe(lentilCanon.id);
    expect(canonIdByItem.get('ghee')).toBe(gheeCanon.id);
    expect(canonIdByItem.get('garlic')).toBe(garlicCanon.id);

    // ── Reload → parsed + canonical structure persisted to Firestore ─────────
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Parsed Dahl' })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toContainText(
      '300g red lentils, rinsed',
    );
    // No unmatched markers survive the reload — the matches are persisted.
    await expect(page.getByTestId('match-state-unmatched')).toHaveCount(0, {
      timeout: SYNC_TIMEOUT,
    });

    await page.waitForFunction(() => Boolean(window.__e2e), null, { timeout: 10_000 });
    const afterReload = await page.evaluate<Recipe[]>(() => window.__e2e!.getRecipes() as Recipe[]);
    const reloaded = afterReload.find((r) => r.id === recipeId)!;
    const reloadedItems = reloaded.ingredients.flatMap((g) => g.items);
    expect(reloadedItems).toHaveLength(3);
    for (const ing of reloadedItems) {
      expect(ing.parsed).not.toBeNull();
      expect(ing.matchState).toBe('matched');
      expect(ing.canonId).not.toBeNull();
    }
    const reloadedLentil = reloaded.ingredients[0]!.items[0]!;
    expect(reloadedLentil.parsed!.quantity).toEqual({ type: 'single', value: 300 });
    expect(reloadedLentil.parsed!.displayText).toBe('1 ½ cups');
  });
});
