// The seven weekday keys used by the template and by weekday-indexing of dates.
// Monday-first is the canonical internal order. `firstDayOfWeek` (in
// MealPlanConfig) only changes how a week is laid out for the user — it never
// reshapes this enum, so changing the big-shop day needs no data migration.
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
