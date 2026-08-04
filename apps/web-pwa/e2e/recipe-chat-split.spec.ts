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
import { SYNC_TIMEOUT } from './helpers/timeouts';

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
