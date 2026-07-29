import type { MealPlanWeek } from '../mealPlan/index.js';

// The dates in a week whose chefs include `memberId`, in calendar order.
//
// This is the whole of "personalisation" on the Mine view (issue #634): the data
// is family-shared, and *who am I* is applied as a filter over it. Nothing is
// stored per user.
//
// Pure — no I/O, no clock (CLAUDE.md Rule 1). An empty `memberId` (nobody
// resolved yet) matches nothing rather than everything: a screen that claimed
// every night was yours would be worse than one that claimed none.
export function chefDaysForMember(week: MealPlanWeek, memberId: string): string[] {
  if (!memberId) return [];
  return Object.entries(week.days)
    .filter(([, day]) => day.chefs.includes(memberId))
    .map(([date]) => date)
    .sort();
}
