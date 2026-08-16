/**
 * The recipe and its chef, side by side (issue #696, Phase 4).
 *
 * On a screen with room for it the dish and the conversation about it sit next to each
 * other: the recipe on one half, the chat on the other, with the gutter falling on the
 * crease. The target is a Pixel 9 Pro Fold, unfolded — the same device, the same measured
 * `split` gate and the same reasoning as the planner's `mealplan-split.spec.ts`.
 *
 * None of this can live in the unit suite: jsdom reports `matches: false` for every media
 * query, so `RecipeViewPage.chats.test.ts` only ever exercises the phone path — which is
 * exactly what we want it to keep doing.
 *
 * Three facts are worth pinning:
 *
 *   1. It is a PANE, not a drawer. The drawer is SUPPRESSED at this size rather than
 *      painted over, and there is no `role="dialog"` anywhere on the page.
 *   2. The two columns are EQUAL. The device reports one viewport segment, so nothing can
 *      be aligned to the crease directly; the gutter stays over it only because the halves
 *      are the same width, which is why the equality is asserted to a pixel.
 *   3. Selecting another chat swaps the pane and the recipe does not move — the whole
 *      point of docking the conversation beside the dish rather than over it.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { seedRecipe } from './helpers/seed';
import { SYNC_TIMEOUT } from './helpers/timeouts';
import type { Recipe } from '@salt/domain';
import type { Page } from '@playwright/test';

// The fold, unfolded — its usable frame inside a browser tab, measured on the real
// device. Identical to `mealplan-split.spec.ts`; see the note there for why the width is
// four pixels under Tailwind's `md` and the gate is therefore a named `split` variant.
const VIEWPORT = { width: 755, height: 587 };

// The gutter between the columns (`split:gap-10`), which is what sits over the crease.
const GUTTER_PX = 40;

// Slack for sub-pixel layout. Deliberately tight: "equal halves" is the mechanism keeping
// the gutter on the fold, so a couple of pixels of drift is a real defect, not rounding.
const EPSILON = 1;

const RECIPE_TITLE = 'Split Test Dahl';

test.describe('recipes — the dish and its chef, side by side', () => {
  test.use({ viewport: VIEWPORT });

  test('the chat docks beside the recipe as equal halves, with no drawer, and swaps on a tap', async ({
    page,
  }, testInfo) => {
    // One create plus two session writes and a reload's worth of settling — the
    // single-tab tier, with headroom.
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill(RECIPE_TITLE);
    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByRole('heading', { name: RECIPE_TITLE })).toBeVisible();

    // ── The chat is docked, and it is not a drawer ───────────────────────────
    const chatColumn = page.getByTestId('recipe-chat-sidebar');
    await expect(chatColumn).toBeVisible({ timeout: SYNC_TIMEOUT });
    // Suppressed, not merely hidden: at this size the drawer is not rendered at all.
    await expect(page.getByTestId('recipe-chat-drawer')).toHaveCount(0);
    // And nothing on the page is a dialog — no scrim, no focus trap, no scroll lock.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The chat list lives in that column, above the conversation it selects — and
    // there is exactly one of it on the page.
    await expect(page.getByTestId('recipe-chat-list')).toHaveCount(1);
    await expect(chatColumn.getByTestId('recipe-chat-list')).toBeVisible();

    // ── The navigation is unchanged at this size ─────────────────────────────
    // The split seam (700px) and the nav seam (1024px) are deliberately different
    // numbers: the fold keeps its bottom bar AND gets two columns.
    const visibleNav = page
      .getByRole('navigation', { name: 'Main navigation' })
      .filter({ visible: true });
    await expect(visibleNav).toHaveCount(1);
    const navBox = (await visibleNav.boundingBox())!;
    expect(Math.abs(navBox.y + navBox.height - VIEWPORT.height)).toBeLessThanOrEqual(EPSILON);

    // ── Equal halves, with the gutter between them ───────────────────────────
    const grid = page.getByTestId('recipe-view');
    const recipeColumn = grid.locator('> div').first();
    const recipeBox = (await recipeColumn.boundingBox())!;
    const chatBox = (await chatColumn.boundingBox())!;
    expect(Math.abs(recipeBox.width - chatBox.width)).toBeLessThanOrEqual(EPSILON);
    expect(Math.abs(chatBox.x - (recipeBox.x + recipeBox.width) - GUTTER_PX)).toBeLessThanOrEqual(
      EPSILON,
    );

    // ── Two conversations, and selecting one swaps the pane ──────────────────
    await page.getByTestId('recipe-chat-new-btn').click();
    await expect(page.getByTestId('recipe-chat-list-item')).toHaveCount(1, {
      timeout: SYNC_TIMEOUT,
    });
    await page.getByTestId('recipe-chat-new-btn').click();
    await expect(page.getByTestId('recipe-chat-list-item')).toHaveCount(2, {
      timeout: SYNC_TIMEOUT,
    });

    // Still no drawer, and still no dialog, after opening chats at this size.
    await expect(page.getByTestId('recipe-chat-drawer')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const items = page.getByTestId('recipe-chat-list-item');
    const recipeTopBefore = (await recipeColumn.boundingBox())!.y;

    // The newest is selected; picking the older one swaps which is marked.
    await expect(items.nth(0)).toHaveClass(/border-primary/);
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveClass(/border-primary/);
    await expect(items.nth(0)).not.toHaveClass(/border-primary/);

    // …and the recipe beside it did not move.
    expect(Math.abs((await recipeColumn.boundingBox())!.y - recipeTopBefore)).toBeLessThanOrEqual(
      EPSILON,
    );
  });
});

// ─── Two panes, two scrollbars (issue #737) ───────────────────────────────────

const SEED_TIME = '2026-01-01T00:00:00.000Z';

/**
 * A recipe long enough that its column genuinely overflows, or an `outing` — which by
 * definition has no ingredients and no method, and is therefore the case with nothing
 * to scroll at all. Both exist to prove the composer's reachability does not depend on
 * the recipe's length, which under the old `sticky` + `calc()` pairing it did.
 */
function buildRecipe(id: string, title: string, kind: 'recipe' | 'outing'): Recipe {
  const long = kind === 'recipe';
  return {
    id,
    schemaVersion: 1,
    kind,
    title,
    description: null,
    ingredients: long
      ? [
          {
            id: 'group-1',
            name: null,
            items: Array.from({ length: 10 }, (_, i) => ({
              id: `ing-${i + 1}`,
              rawText: `${i + 1} portion of ingredient number ${i + 1}`,
              parsed: null,
              canonId: null,
              matchState: 'pending' as const,
              isOptional: false,
              firstUsedInStepId: 'step-1',
            })),
          },
        ]
      : [],
    steps: long
      ? Array.from({ length: 12 }, (_, i) => ({
          id: `step-${i + 1}`,
          text: `Step ${i + 1}. Wordy enough that the recipe column has real length to scroll.`,
          timer: null,
          note: null,
        }))
      : [],
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
    componentRecipeIds: [],
    image: null,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    createdBy: '',
    lastEditedBy: '',
  };
}

/** How much `<main>` has left to scroll. Under `fill` this must be nothing. */
function mainScrollRange(page: Page): Promise<number> {
  return page.locator('main').evaluate((el) => el.scrollHeight - el.clientHeight);
}

/**
 * The floor the composer has to sit above: the top of the bottom navigation, not the
 * bottom of the viewport. At this size the nav is a fixed bar OVER the page, so a box
 * measuring as "inside the viewport" can still be completely hidden behind it — which
 * is exactly what a short recipe looked like before this change.
 */
async function usableFloor(page: Page): Promise<number> {
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).filter({ visible: true });
  return (await nav.boundingBox())!.y;
}

/** Assert the composer is fully on screen and clear of the bottom navigation. */
async function expectComposerUsable(page: Page): Promise<void> {
  const box = (await page.getByTestId('chat-input').boundingBox())!;
  const floor = await usableFloor(page);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(floor + EPSILON);
}

async function openSeeded(page: Page, recipe: Recipe, email: string): Promise<void> {
  await gotoAndSignIn(page, email, '/', { admin: true });
  await seedRecipe(page, recipe);
  await page.goto(`/#/recipes/${recipe.id}`);
  await expect(page.getByRole('heading', { name: recipe.title })).toBeVisible({
    timeout: SYNC_TIMEOUT,
  });
  await expect(page.getByTestId('recipe-chat-sidebar')).toBeVisible({ timeout: SYNC_TIMEOUT });
  // A conversation has to exist for the composer to be on screen at all.
  await page.getByTestId('recipe-chat-new-btn').click();
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: SYNC_TIMEOUT });
}

test.describe('recipes — the dish and its chef scroll separately', () => {
  test.use({ viewport: VIEWPORT });

  test('the message box is on screen without scrolling, and the panes do not drag each other', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const recipe = buildRecipe('e2e-737-long', 'Split Scroll Dahl', 'recipe');
    await openSeeded(page, recipe, uniqueEmail(testInfo.testId));

    // ── The composer is there on load, with nothing scrolled ─────────────────
    // The regression this pins: it used to sit ~228px below the viewport floor.
    const input = page.getByTestId('chat-input');
    await expectComposerUsable(page);

    // ── And the page itself has nothing left to scroll ───────────────────────
    // This is what "two real scrollers" means: the page fills <main>, so the ONE
    // shared scrollbar that coupled the panes no longer exists.
    expect(await mainScrollRange(page)).toBeLessThanOrEqual(EPSILON);

    // ── Scrolling the recipe leaves the chat exactly where it is ─────────────
    const recipePane = page.getByTestId('recipe-view').locator('> div').first();
    const chatPane = page.getByTestId('recipe-chat-sidebar');
    const chatTopBefore = (await chatPane.boundingBox())!.y;
    const inputTopBefore = (await input.boundingBox())!.y;

    await recipePane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    // The recipe column really did scroll — otherwise the rest asserts nothing.
    expect(await recipePane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(Math.abs((await chatPane.boundingBox())!.y - chatTopBefore)).toBeLessThanOrEqual(
      EPSILON,
    );
    expect(Math.abs((await input.boundingBox())!.y - inputTopBefore)).toBeLessThanOrEqual(EPSILON);

    // ── The dish's actions stay put however far the recipe is scrolled ───────
    const cook = page.getByTestId('recipe-cook-button');
    const cookBox = (await cook.boundingBox())!;
    expect(cookBox.y).toBeGreaterThanOrEqual(0);
    expect(cookBox.y + cookBox.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('a short outing — nothing to scroll, and the message box is still there', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    // "When you CBA": no ingredients, no method. Under the old layout there was no
    // scroll range with which to bring the composer up, so it was unreachable.
    const outing = buildRecipe('e2e-737-outing', 'Split Scroll Chippy', 'outing');
    await openSeeded(page, outing, uniqueEmail(testInfo.testId));

    await expectComposerUsable(page);
    expect(await mainScrollRange(page)).toBeLessThanOrEqual(EPSILON);
  });
});
