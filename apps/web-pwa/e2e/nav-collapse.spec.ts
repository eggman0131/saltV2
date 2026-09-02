/**
 * Folding the side navigation away (#1143, Phase 1).
 *
 * From `lg` up the shell spends 256px of a laptop window on a navigation column.
 * A control at the left of the top bar removes it, and the page takes the space.
 *
 * None of this can live in the unit suite. jsdom reports `matches: false` for
 * every media query, so `AppShell.test.ts` can pin what is in the DOM but never
 * that the page is wider for it — the width is the whole user-visible point, and
 * only a real browser doing real layout can say it moved.
 *
 * Three facts are worth pinning here:
 *
 *   1. The nav is NOT RENDERED, not hidden. A nav that is merely covered or
 *      `display:none`-d by a page stays in the accessibility tree at a width
 *      where it is meant to be gone; this asserts there is no navigation
 *      landmark on screen at all while collapsed (issue #641's defect, one gate
 *      along from cook mode).
 *   2. The page gets exactly the nav's width back — `w-64`, 256px — and gets it
 *      without any page-level code, because `<main>` is a `flex-1` sibling.
 *   3. Below `lg` the control does not exist. That seam is the SideNav's own
 *      `hidden … lg:flex`, and it is deliberately NOT the `split` two-pane seam
 *      at 700px: nothing here may reach `mealplan-split.spec.ts` or
 *      `recipe-chat-split.spec.ts`, which run at 755px with no SideNav on screen.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { HYDRATE_TIMEOUT } from './helpers/timeouts';
import type { Page } from '@playwright/test';

// The SideNav's `w-64`. It is a plain Tailwind class and deliberately not a
// token (ui-spec-v15 §1.8) — nothing but this assertion reads the number, and it
// reads it to prove the page got it back.
const SIDE_NAV_WIDTH_PX = 256;

// Slack for sub-pixel layout. Tight on purpose: "the page grew by the nav's
// width" is the feature, so drift of more than a pixel is a defect, not rounding.
const EPSILON = 1;

/** The width of the page's content area — what the reclaimed space goes to. */
async function mainWidth(page: Page): Promise<number> {
  const box = await page.getByRole('main').boundingBox();
  if (!box) throw new Error('no bounding box for <main>');
  return box.width;
}

/** The navigation actually on screen. Both navs carry the same accessible name. */
function visibleNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main navigation' }).filter({ visible: true });
}

test.describe('the side navigation folds away', () => {
  // Playwright's `Desktop Chrome` viewport is 1280x720 — above `lg` (1024px), so
  // the SideNav is on screen and the BottomNav is not. Stated rather than
  // re-declared: the point is that the DEFAULT desktop project exercises this.

  test('collapsing hands the page the nav’s 256px, and toggling back returns it', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email, '/');

    // The shell is up once its control is on screen; the name says what pressing
    // it does, so "Hide navigation" is also the assertion that the nav is open.
    const hide = page.getByRole('button', { name: 'Hide navigation' });
    await expect(hide).toBeVisible({ timeout: HYDRATE_TIMEOUT });

    // One navigation on screen at this width, and it is the SIDE one — its left
    // edge is the window's, which is what its position proves.
    await expect(visibleNav(page)).toHaveCount(1);
    const navBox = await visibleNav(page).boundingBox();
    expect(navBox).not.toBeNull();
    expect(Math.abs(navBox!.width - SIDE_NAV_WIDTH_PX)).toBeLessThanOrEqual(EPSILON);
    expect(Math.abs(navBox!.x)).toBeLessThanOrEqual(EPSILON);

    const openWidth = await mainWidth(page);

    // ── Collapsed: no navigation on screen at all ────────────────────────────
    await hide.click();
    // Not merely invisible — there is no navigation landmark left to browse.
    // The nav is unmounted, so a keyboard user cannot reach it and a screen
    // reader cannot announce it (ui-spec-v15 §1.2).
    await expect(visibleNav(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);

    // …and the page took the width, without a line of page-level code.
    await expect
      .poll(async () => Math.abs((await mainWidth(page)) - (openWidth + SIDE_NAV_WIDTH_PX)))
      .toBeLessThanOrEqual(EPSILON);

    // ── The way back is in the same place, and says so ───────────────────────
    const show = page.getByRole('button', { name: 'Show navigation' });
    await expect(show).toBeVisible();
    await show.click();

    await expect(visibleNav(page)).toHaveCount(1);
    await expect
      .poll(async () => Math.abs((await mainWidth(page)) - openWidth))
      .toBeLessThanOrEqual(EPSILON);
  });

  test('the choice survives moving between pages, and a reload forgets it', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email, '/');
    await page.getByRole('button', { name: 'Hide navigation' }).click({ timeout: HYDRATE_TIMEOUT });
    await expect(visibleNav(page)).toHaveCount(0);

    // AppShell is mounted once for the app's life, so a route change does not
    // touch the state it holds.
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();
    await expect(visibleNav(page)).toHaveCount(0);

    // In-memory by decision (ui-spec-v15 §1.8): nothing is written anywhere, so
    // a reload comes back open. This is the assertion that would go red if a
    // fourth browser-storage key or a member-document field were ever added.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Hide navigation' })).toBeVisible({
      timeout: HYDRATE_TIMEOUT,
    });
    await expect(visibleNav(page)).toHaveCount(1);
  });
});

test.describe('below the nav seam there is nothing to collapse', () => {
  // A phone. Well below `lg`, so the SideNav does not exist at this width and the
  // BottomNav is the navigation — there is nothing for a control to do.
  test.use({ viewport: { width: 390, height: 844 } });

  test('no toggle is on screen at a phone width', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email, '/');

    // The bottom bar is the navigation here, and its presence is what says the
    // shell has finished rendering — so the toggle's absence below is a real
    // absence rather than a page that has not arrived yet.
    await expect(visibleNav(page)).toHaveCount(1, { timeout: HYDRATE_TIMEOUT });
    const navBox = await visibleNav(page).boundingBox();
    expect(navBox).not.toBeNull();
    expect(Math.abs(navBox!.y + navBox!.height - 844)).toBeLessThanOrEqual(EPSILON);

    // `hidden lg:inline-flex`: `display:none` at this width, which takes it out
    // of the tab order and the accessibility tree as well as off the screen.
    // Asserted as hidden rather than as count 0 so the assertion holds whether
    // or not the role engine resolves a display:none button at all.
    await expect(page.getByRole('button', { name: /navigation$/ })).toBeHidden();
  });
});
