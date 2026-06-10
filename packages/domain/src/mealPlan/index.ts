// Meal planning module — published surface (issue #169).
// This file is the ONLY thing other domain modules and adapters import from
// mealPlan. Anything not re-exported here is private. See docs/meal-planning.md.

export type { Weekday } from './entities/Weekday.js';
export { WEEKDAYS } from './entities/Weekday.js';
export type { Attendee, Day } from './entities/Day.js';
export type { MealPlanConfig } from './entities/MealPlanConfig.js';
export type { MealPlanTemplate } from './entities/MealPlanTemplate.js';
export type { MealPlanWeek } from './entities/MealPlanWeek.js';

export { weekStartFor, weekDates, weekdayOf, WEEKDAY_INDEX } from './queries/weekdays.js';

export { emptyDay, emptyWeek, emptyTemplate } from './commands/emptyDay.js';
export { instantiateWeek } from './commands/instantiateWeek.js';
export {
  setDayNote,
  setDayChefs,
  setDayGuests,
  addAttendee,
  removeAttendee,
  setAttendeeHomeTime,
  setAttendeeNote,
} from './commands/dayMutators.js';
