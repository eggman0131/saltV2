/**
 * The chef, raised over the recipe rather than instead of it (issue #696, Phase 3).
 *
 * The promise this spec pins is the one thing the feature is for: on a phone, opening a
 * chat about a dish does not take you off the dish. So it walks the journey — create a
 * recipe with an ingredient, start a chat from the recipe page, and then assert what has
 * to be true while the chat is up:
 *
 *   the drawer is on screen AND the ingredients are still readable above it
 *     → dragging the handle up gives the chat most of the screen
 *       → the page header is still not covered (the #641 rule for a non-modal overlay)
 *         → the bottom navigation is reachable throughout
 *           → closing leaves you on the recipe, with the chat listed on it
 *
 * No AI stub: nothing here sends a turn. Creating the session is an ordinary Firestore
 * write, and every wait below is bound to a rendered signal rather than a clock.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

// A phone, pinned explicitly: the drawer only exists below the docked seam, and the
// project's default desktop viewport would put this spec on the column layout instead.
// Same numbers as `recipe-alternatives.spec.ts` and `mealplan.spec.ts`.
test.use({ viewport: { width: 393, height: 851 } });

const RECIPE_TITLE = 'Drawer Test Dahl';
const INGREDIENT = '1 ½ cups red lentils, rinsed';

test.describe('recipes — the chef drawer on a phone', () => {
  test('opening a chat keeps you on the recipe, drags between two stops, and closes back', async ({
    page,
  }, testInfo) => {
    // Single-tab, no cross-tab convergence and no AI wait: the 60 s single-tab tier.
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    // ── A recipe with something to read while you chat ───────────────────────
    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill(RECIPE_TITLE);
    await page.getByTestId('recipe-add-group-btn').click();
    // .nth(0) = the single group row this test just created, not a global index.
    const group = page.getByTestId('recipe-group').nth(0);
    await group.getByTestId('recipe-add-ingredient-btn').click();
    await group.getByTestId('recipe-ingredient-input').nth(0).fill(INGREDIENT);
    await page.getByTestId('recipe-save-btn').click();

    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    const recipeUrl = page.url();
    await expect(page.getByRole('heading', { name: RECIPE_TITLE })).toBeVisible();

    // ── The chat list is on the dish, and empty ──────────────────────────────
    await expect(page.getByTestId('recipe-chat-list')).toBeVisible();
    await expect(page.getByTestId('recipe-chat-list-item')).toHaveCount(0);

    // ── Start a chat: the drawer rises, the recipe stays ─────────────────────
    await page.getByTestId('recipe-chat-new-btn').click();

    const drawer = page.getByTestId('recipe-chat-drawer');
    await expect(drawer).toBeVisible({ timeout: SYNC_TIMEOUT });
    // Still the recipe, not the chat route. This is the whole feature.
    expect(page.url()).toBe(recipeUrl);
    // Named after the dish until the chef retitles it.
    await expect(drawer).toContainText(`${RECIPE_TITLE} chat`);

    // Both on screen at once: the composer AND the thing it is about.
    await expect(drawer.getByTestId('chat-input')).toBeVisible();
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toBeVisible();
    await expect(page.getByTestId('recipe-view-ingredient').nth(0)).toContainText(INGREDIENT);

    // Non-modal, and deliberately so: no dialog role, no modal flag, and the page
    // behind is not pointer-events-dead (which is what `Sheet` would have done).
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(drawer).not.toHaveAttribute('aria-modal', 'true');
    await expect
      .poll(() => page.evaluate(() => document.body.style.pointerEvents))
      .not.toBe('none');

    // The bottom navigation is reachable the whole time — the drawer sits above it.
    const nav = page.getByRole('navigation').first();
    await expect(nav).toBeVisible();

    // ── Drag the handle up: the chat takes most of the screen ────────────────
    const handle = page.getByTestId('recipe-chat-drawer-handle');
    await expect(handle).toBeVisible();
    // The drawer RISES into its resting stop, so both the height and the handle's
    // position are still moving for a few frames after it becomes visible. Measuring
    // either mid-flight reads a number that was never a stop, and — worse — aims the
    // drag at where the handle used to be, so the gesture lands on nothing.
    const peekHeight = await settledHeight(page);

    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Several steps so the drag clears the tap slop and registers as a gesture.
    await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 8 });
    await page.mouse.move(box.x + box.width / 2, box.y - 260, { steps: 8 });
    await page.mouse.up();

    // The spring settles on the full stop — polled, because the settle is animated.
    await expect.poll(() => drawerHeight(page)).toBeGreaterThan(peekHeight + 50);

    // Even at full, the page is never entirely covered (#641): a strip stays.
    await expect.poll(() => drawerTop(page)).toBeGreaterThan(0);
    await expect(nav).toBeVisible();

    // ── Close: back on the recipe, with the conversation now listed on it ────
    await page.getByTestId('recipe-chat-drawer-close').click();
    await expect(drawer).toHaveCount(0);
    expect(page.url()).toBe(recipeUrl);
    await expect(page.getByRole('heading', { name: RECIPE_TITLE })).toBeVisible();
    await expect(page.getByTestId('recipe-chat-list-item')).toHaveCount(1);
    await expect(page.getByTestId('recipe-chat-list-item')).toContainText(`${RECIPE_TITLE} chat`);
  });
});

/**
 * The drawer's height once the spring has stopped moving it — two consecutive equal
 * readings. Everything that measures or aims at the drawer has to wait for this.
 */
async function settledHeight(page: import('@playwright/test').Page): Promise<number> {
  let previous = -1;
  await expect
    .poll(async () => {
      const height = await drawerHeight(page);
      const settled = height > 0 && height === previous;
      previous = height;
      return settled;
    })
    .toBe(true);
  return previous;
}

/** The drawer's rendered height, in CSS pixels. */
async function drawerHeight(page: import('@playwright/test').Page): Promise<number> {
  const box = await page.getByTestId('recipe-chat-drawer').boundingBox();
  return box?.height ?? 0;
}

/** The drawer's top edge in viewport coordinates — how much page is left above it. */
async function drawerTop(page: import('@playwright/test').Page): Promise<number> {
  const box = await page.getByTestId('recipe-chat-drawer').boundingBox();
  return box?.y ?? 0;
}
