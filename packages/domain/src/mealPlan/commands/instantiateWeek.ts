import type { Day } from '../entities/Day.js';
import type { MealPlanConfig } from '../entities/MealPlanConfig.js';
import type { MealPlanTemplate } from '../entities/MealPlanTemplate.js';
import type { MealPlanWeek } from '../entities/MealPlanWeek.js';
import { weekDates, weekdayOf, weekStartFor } from '../queries/weekdays.js';

// Deep-copy a day so the produced week never shares mutable arrays with the
// template it was instantiated from.
function cloneDay(day: Day): Day {
  return {
    note: day.note,
    recipeIds: [...day.recipeIds],
    chefs: [...day.chefs],
    attendees: day.attendees.map((a) => ({ ...a })),
  };
}

// The "load template" mechanic: build a concrete week by copying, for each of
// its seven dates, the template's day for that date's weekday. `startDate` is
// normalised to the true week start under `config` first, so passing any date
// in the target week is safe. Pure — returns a fresh week, `updatedAt` blank for
// the service to stamp on save.
export function instantiateWeek(
  startDate: string,
  config: MealPlanConfig,
  template: MealPlanTemplate,
): MealPlanWeek {
  const start = weekStartFor(startDate, config.firstDayOfWeek);
  const days = Object.fromEntries(
    weekDates(start).map((date) => [date, cloneDay(template.days[weekdayOf(date)])]),
  );
  return {
    id: start,
    schemaVersion: 1,
    startDate: start,
    days: days as MealPlanWeek['days'],
    updatedAt: '',
  };
}
