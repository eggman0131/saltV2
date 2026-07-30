/**
 * Meal planner first E2E (issue #169 coverage gap).
 *
 * Exercises the weekly planner happy path end-to-end:
 *   open the current week → open a day's editor sheet and configure it (meal
 *   note + attendee + chef + guests) → the whole-doc save round-trips to
 *   Firestore → reload → the data persists (proving the Firestore round-trip,
 *   not just a hot store).
 *
 * Determinism: the week id is a date that depends on the run date, so nothing is
 * hardcoded. We click `this-week`, read the actual `startDate` from the
 * `getMealPlanSnapshot()` bridge, derive a concrete day key from it, and assert
 * against the exact key we used.
 *
 * Members: the signed-in user is seeded onto the allowlist as a member whose id
 * is the normalised email (see helpers/auth.ts), so it appears as a member chip
 * with attendee/chef testids keyed by that email. We use it as the attendee.
 *
 * There is intentionally no delete/clear assertion: the meal planner has no
 * delete/clear/deferred-delete pattern (a day is reset by editing it back or by
 * Load template, not deleted). Recipe attach is a reserved seam (#17, not
 * shipped) — "add a meal" means setting the day's meal note + attendees here.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

// Read the current week's startDate from the in-page store bridge.
async function readStartDate(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => window.__e2e!.getMealPlanSnapshot().startDate);
}

// The note saved for a given day key, or undefined if the day isn't present.
async function readDayNote(
  page: import('@playwright/test').Page,
  dayKey: string,
): Promise<string | undefined> {
  return page.evaluate((key) => window.__e2e!.getMealPlanSnapshot().days[key]?.note, dayKey);
}

test.describe('meal planner — week happy path', () => {
  test('configure a day, save, reload, and the plan persists', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    // Sign in at the root (AuthGate blocks rendering until authed), then open the
    // planner via its hash route — mirrors the recipe spec's deep-link pattern.
    await gotoAndSignIn(page, email, '/');
    await page.goto('/#/mealplan');

    // Anchor deterministically on the current week (the page also resets to it
    // on mount, but click explicitly so the test owns the anchor).
    await expect(page.getByTestId('this-week')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await page.getByTestId('this-week').click();
    await expect(page.getByTestId('week-range')).not.toHaveText('', { timeout: SYNC_TIMEOUT });

    // Derive a real day key from the store rather than guessing a date. TODAY is
    // the anchor: the planner opens on today's row and puts it flush under the
    // header (#639), so it is the one day guaranteed to be both in the displayed
    // week and on screen — which a fixed "day 3 of the week" is not, now that the
    // page is a deck rather than a scroller and, from the last two days of the
    // cycle, also holds next week beneath it.
    const startDate = await readStartDate(page);
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dayKey = await page.evaluate(() => {
      const days = window.__e2e!.getMealPlanSnapshot().days;
      const today = new Date().toLocaleDateString('en-CA');
      return today in days ? today : Object.keys(days).sort()[0]!;
    });
    expect(dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ── Next week appears from Wednesday (#639, Phase 6) ──
    // Date-dependent by nature, so the expectation is DERIVED, not hardcoded:
    // from the last two days of the cycle the deck also holds the whole of next
    // week under a dated mark, and before that it holds this week alone. The
    // primary snapshot is still one week — next week's days are a second document
    // and never appear in it, so the day key above stays unambiguous either way.
    // Counted rather than branched on: the expected count IS the expectation, so
    // the same two assertions run on every day of the week. A count (not
    // visibility) is the honest test — the appended week starts below the fold of
    // a deck that opens on today.
    const { expectedNextWeek, nextWeekFirstDay } = await page.evaluate((start: string) => {
      const utc = (d: string) => new Date(`${d}T00:00:00.000Z`);
      const today = new Date().toLocaleDateString('en-CA');
      const index = Math.round((utc(today).getTime() - utc(start).getTime()) / 86_400_000);
      const next = utc(start);
      next.setUTCDate(next.getUTCDate() + 7);
      // The last two days of a seven-day cycle — the domain rule, restated here
      // because e2e sees only the wire, not `weekExtendsIntoNext`.
      return {
        expectedNextWeek: Number(index >= 5),
        nextWeekFirstDay: next.toISOString().slice(0, 10),
      };
    }, startDate);
    await expect(page.getByTestId('next-week-mark')).toHaveCount(expectedNextWeek, {
      timeout: SYNC_TIMEOUT,
    });
    await expect(page.getByTestId(`day-${nextWeekFirstDay}`)).toHaveCount(expectedNextWeek, {
      timeout: SYNC_TIMEOUT,
    });

    const testid = `day-${dayKey}`;
    const meal = `Spaghetti bolognese ${testInfo.testId}`;

    // Tap the day's row to raise its editor sheet (#640).
    await page.getByTestId(`${testid}-summary`).click();
    await expect(page.getByTestId(`${testid}-detail`)).toBeVisible({ timeout: SYNC_TIMEOUT });

    // Set the meal note (this is "add a meal to a day" — recipe attach is a
    // reserved, unshipped seam).
    await page.getByTestId(`${testid}-note`).fill(meal);

    // Mark the signed-in member attending and make them chef; add a guest.
    // Attending reveals the home time ON THE MEMBER'S OWN LINE (#640, Phase 3) —
    // no second row, and the personal note stays behind its affordance, so the
    // chef hat is reachable without scrolling the sheet.
    await page.getByTestId(`${testid}-attend-${email}`).click();
    await expect(page.getByTestId(`${testid}-time-${email}`)).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });
    await page.getByTestId(`${testid}-chef-${email}`).click();
    await page.getByTestId(`${testid}-guests-inc`).click();

    // Every edit is an optimistic whole-doc save. Poll the store snapshot until
    // it reflects all four mutations for our day key.
    await expect.poll(() => readDayNote(page, dayKey), { timeout: SYNC_TIMEOUT }).toBe(meal);
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const day = window.__e2e!.getMealPlanSnapshot().days[key];
            return {
              note: day?.note,
              chefs: day?.chefs ?? [],
              attendees: (day?.attendees ?? []).map((a) => a.memberId),
              guests: day?.guests ?? 0,
            };
          }, dayKey),
        { timeout: SYNC_TIMEOUT },
      )
      .toEqual({ note: meal, chefs: [email], attendees: [email], guests: 1 });

    // The rendered guest count reflects the saved state.
    await expect(page.getByTestId(`${testid}-guests-count`)).toHaveText('1', {
      timeout: SYNC_TIMEOUT,
    });

    // ── Reload: prove the Firestore round-trip, not a hot store ──
    // The page's onMount anchors to this week on its own; clicking `this-week`
    // again would force a re-subscription (the store briefly nulls the week),
    // which remounts the day editors mid-interaction. So we rely on the mount
    // anchor and just wait for the week to load.
    await page.goto('/#/mealplan');
    await expect(page.getByTestId('this-week')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId(testid)).toBeVisible({ timeout: SYNC_TIMEOUT });

    // The same week loads from Firestore with our day intact.
    await expect.poll(() => readDayNote(page, dayKey), { timeout: SYNC_TIMEOUT }).toBe(meal);
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const day = window.__e2e!.getMealPlanSnapshot().days[key];
            return {
              chefs: day?.chefs ?? [],
              attendees: (day?.attendees ?? []).map((a) => a.memberId),
              guests: day?.guests ?? 0,
            };
          }, dayKey),
        { timeout: SYNC_TIMEOUT },
      )
      .toEqual({ chefs: [email], attendees: [email], guests: 1 });

    // And the persisted state is reflected in the DOM after reload.
    await expect(page.getByTestId(`${testid}-summary`)).toContainText(meal, {
      timeout: SYNC_TIMEOUT,
    });
    // Open the day again to inspect the editor. One click, no retry: which day is
    // open is owned by the PAGE now (#640), so a week settling in from Firestore
    // re-renders the row without closing the sheet. Under the old row-local
    // toggle this needed a `toPass` loop, because the snapshot that arrived
    // mid-interaction reset it.
    await page.getByTestId(`${testid}-summary`).click();
    await expect(page.getByTestId(`${testid}-detail`)).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId(`${testid}-note`)).toHaveValue(meal, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId(`${testid}-guests-count`)).toHaveText('1', {
      timeout: SYNC_TIMEOUT,
    });
  });
});
