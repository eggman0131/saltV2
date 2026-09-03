import type { Day } from '../entities/Day.js';
import type { MealPlanTemplate } from '../entities/MealPlanTemplate.js';
import type { MealPlanWeek } from '../entities/MealPlanWeek.js';
import { WEEKDAYS } from '../entities/Weekday.js';
import { weekDates } from '../queries/weekdays.js';

// A blank day: no meal note, no recipes, no chefs, no attendees, no guests.
export function emptyDay(): Day {
  return { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0 };
}

// A blank template with all seven weekdays empty. The type only requires a
// partial map (issue #1056) — emitting all seven is this function's contract,
// not the type's, and the test at tests/mealPlan/mealPlan.test.ts pins it.
export function emptyTemplate(): MealPlanTemplate {
  const days: MealPlanTemplate['days'] = {};
  for (const wd of WEEKDAYS) days[wd] = emptyDay();
  return { schemaVersion: 1, days };
}

// A blank week for `startDate` (its seven dates empty). `updatedAt` is left blank
// until the service stamps and persists it on first edit / load-template.
export function emptyWeek(startDate: string): MealPlanWeek {
  const days = Object.fromEntries(weekDates(startDate).map((d) => [d, emptyDay()]));
  return {
    id: startDate,
    schemaVersion: 1,
    startDate,
    days: days as MealPlanWeek['days'],
    updatedAt: '',
  };
}
