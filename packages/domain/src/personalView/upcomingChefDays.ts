import type { Day, MealPlanWeek } from '../mealPlan/index.js';

/** One night from today onward that a given member is down to cook. */
export interface ChefNight {
  /** The `YYYY-MM-DD` date key the night is stored under. */
  readonly date: string;
  readonly day: Day;
}

/**
 * The nights, from `today` onward, that `memberId` is a chef on — across as many
 * weeks as the caller is holding, in date order.
 *
 * The decision here is not "who is the chef", which the day already says. It is
 * the WINDOW and the SPAN: a member's own nights are a run forward from today
 * that does not stop at the end of a cycle, so a Thursday view of a Friday-start
 * week has to reach into the next document to be true. The planner cannot render
 * that — it renders weeks — so this is a genuinely personal projection rather
 * than a restatement of a page that already exists.
 *
 * Taking an ARRAY of weeks is what makes the boundary a non-event: the caller
 * hands over whichever documents it holds and the answer spans them, with no
 * merge step and no "which week is this row from" bookkeeping anywhere above.
 *
 * An empty `memberId` (nobody resolved yet) matches nothing rather than
 * everything: a screen claiming every night was yours would be worse than one
 * claiming none.
 *
 * Chef membership is the ONLY test. A chef need not be an attendee — cooking for
 * a household you are not eating with is an ordinary Tuesday, and filtering on
 * attendance would quietly drop exactly those nights.
 *
 * The iteration is over each week's STORED date keys, never over the seven dates
 * its start implies. A document written before `firstDayOfWeek` moved holds the
 * keys that were current when it was saved, so a computed cycle can ask for keys
 * that are not there (the same divergence `addRecipeToDay` seeds around) and
 * would produce holes. Stored keys cannot; `date >= today` is what bounds the
 * answer, whichever week a key nominally belongs to.
 *
 * Pure by contract: there is no clock in domain, so the caller supplies today.
 */
export function upcomingChefDays(
  weeks: readonly MealPlanWeek[],
  memberId: string,
  today: string,
): readonly ChefNight[] {
  if (!memberId) return [];
  // Keyed by date, so two documents that disagree about which week owns a date
  // (again: `firstDayOfWeek` moved since one was written) yield ONE night rather
  // than a duplicate row. First week holding it wins — the caller passes them in
  // the order it holds them.
  const byDate = new Map<string, Day>();
  for (const week of weeks) {
    for (const [date, day] of Object.entries(week.days)) {
      if (date < today || byDate.has(date)) continue;
      if (!day.chefs.includes(memberId)) continue;
      byDate.set(date, day);
    }
  }
  return [...byDate]
    .map(([date, day]) => ({ date, day }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
