import type { WeekdayDoc } from '../../schemas/mealPlanDay.js';

// The seven weekday keys used by the template and by weekday-indexing of dates.
// Monday-first is the canonical internal order. `firstDayOfWeek` (in
// MealPlanConfig) only changes how a week is laid out for the user — it never
// reshapes this enum, so changing the big-shop day needs no data migration.
// Schema-first (issue #932): aliased from `WeekdayEnum`.
export type Weekday = WeekdayDoc;

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
