import type { Day, MealPlanWeek } from '../mealPlan/index.js';

/**
 * The plan for one specific date, across whichever weeks the caller is holding.
 *
 * Sibling of {@link upcomingChefDays} and deliberately not a special case of it:
 * that one answers "which nights are MINE", filtering on chef membership, and
 * this one answers "what is happening on this date" for anybody. A kitchen's
 * headline for tonight is true whether or not you are the one cooking it —
 * filtering by chef would blank the screen on exactly the evenings someone else
 * has it covered, which is not a quieter answer, it is a wrong one.
 *
 * Reads each week's STORED date keys rather than the seven its `startDate`
 * implies, for the reason spelled out in `upcomingChefDays`: a document written
 * before `firstDayOfWeek` moved holds the keys that were current when it was
 * saved, and a computed cycle can ask for keys that are not there.
 *
 * First week holding the date wins, matching `upcomingChefDays`, so two documents
 * that disagree about which week owns a date resolve the same way in both.
 *
 * Pure by contract: there is no clock in domain, so the caller supplies the date.
 */
export function dayForDate(weeks: readonly MealPlanWeek[], date: string): Day | null {
  if (!date) return null;
  for (const week of weeks) {
    const day = week.days[date];
    if (day) return day;
  }
  return null;
}
