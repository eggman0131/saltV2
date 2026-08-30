import { dateInZone } from '@salt/domain';

// What day it is HERE, as the `YYYY-MM-DD` every date-keyed collection uses
// (issue #933).
//
// Five modules used to answer this themselves, each with its own
// `new Date().toLocaleDateString('en-CA')` and its own comment explaining the
// `en-CA` trick — `shoppingDayService`, `mealPlanService`, `ShoppingListPage`,
// `MealPlanWeekPage` and `RecipeAddToPlannerSheet`. They agreed, which is the
// only reason the spread was invisible: a shop day, a planner week and an
// add-to-planner sheet that disagreed about today by one day would be a
// genuinely confusing bug, and nothing in CI was watching for it.
//
// THE RULE ITSELF IS NOT HERE. `dateInZone` in `@salt/domain` is the projection
// of an instant onto a zone's calendar; this only supplies the two things the
// domain is not allowed to reach for — the clock and the device's own zone
// (CLAUDE.md Rule 1: no I/O, no clock, no browser API in `packages/domain`).
// That split is why the daily reminder can ask the same question about
// `Europe/London` from a Cloud Function without importing anything from here.
//
// `resolvedOptions().timeZone` is the device's IANA zone and is what
// `toLocaleDateString` was implicitly using all along, so this returns the same
// string the five copies did. `tests/today.test.ts` asserts that over a table of
// instants — in WHATEVER zone the test process runs in, which is UTC in CI and
// Europe/London on the machine this was written on. It cannot assert it for
// every zone, because `toLocaleDateString`'s implicit zone is the only one it
// can compare against; the substitution was checked by hand against
// Europe/London, America/Los_Angeles, Pacific/Kiritimati, Asia/Kolkata and
// Pacific/Chatham (2,016 instants each, no mismatch) before it was made, and the
// half-hour and 45-minute offsets in that list are the ones that would break a
// naive UTC-slice answer.
export function todayIso(): string {
  return dateInZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}
