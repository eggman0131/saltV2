// How a number of minutes is written out on the recipe page (issue #878).
//
// PAGE-LOCAL on purpose, in the same idiom as `cookTimerDuration.ts` beside it.
// This is presentation logic — the words a human reads next to a clock icon —
// not a fact about a recipe, so it stays with the page that renders it rather
// than going into `@salt/domain`. The domain deals in minutes, and always will:
// nothing downstream of it should ever have to parse "6 hr" back into a number.
// It lives in its own module only so it can be unit tested without mounting a
// component.

const MINUTES_PER_HOUR = 60;

/**
 * A duration in minutes, written the way a cook would say it.
 *
 * The page today genuinely says **Cook 360 min**, which is a number nobody
 * converts in their head at the moment they need it. The rule:
 *
 * - Under an hour stays in minutes — `40` → `40 min`. This is the range where
 *   minutes ARE the unit a cook thinks in ("give it twenty").
 * - An hour and over becomes hours, with the leftover minutes when there are
 *   any — `60` → `1 hr`, `75` → `1 hr 15 min`, `90` → `1 hr 30 min`,
 *   `360` → `6 hr`, `1440` → `24 hr`.
 *
 * The switch is at 60 rather than at the 90 the Definition of Done names,
 * because 60 is the only boundary that needs no explanation: one rule, one
 * threshold, and no band in the middle where the same dish reads two ways
 * depending on which field you are looking at.
 *
 * **No days.** A 36-hour cure is `36 hr`, not `1 day 12 hr`. A cook plans a long
 * ferment in hours — "twenty-four hours in the fridge" — and days would force a
 * two-unit phrase to say something one unit already says clearly.
 *
 * **`hr` and `min`, never pluralised.** They are unit abbreviations, matching
 * the `min` the page has always used, so `1 hr` and `6 hr` line up as a column
 * of chips rather than jittering between two spellings.
 *
 * Non-integers are rounded to the nearest minute — the schema types these as
 * `number` and an imported recipe can carry a fractional one; nothing in the
 * app can act on half a minute. Anything at or below zero is `0 min`, which is
 * the honest rendering of a nonsense value and never a thrown error on a page
 * whose only job is to display it.
 */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (!Number.isFinite(whole) || whole <= 0) return '0 min';
  if (whole < MINUTES_PER_HOUR) return `${whole} min`;

  const hours = Math.floor(whole / MINUTES_PER_HOUR);
  const rest = whole % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
