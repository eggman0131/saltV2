// The quarter-hour time pickers (issues #640, #752).
//
// Two screens offer a time as a Select of whole quarter-hours rather than a
// native `<input type="time">`, which renders a different control on every OS
// and makes the minutes an unwanted scroll through all sixty values.
//
// In `lib/` rather than beside either page because the two consumers are in
// DIFFERENT route folders — `routes/recipes/MealCookPlanPage.svelte` and
// `routes/mealplan/MealDayDetail.svelte` — and a route folder must not reach
// into another's helpers.

/**
 * `count` quarter-hour labels as "HH:MM", starting at `fromHour`:00.
 *
 * The window is an ARGUMENT, deliberately. The two pickers do not offer the same
 * list and are not meant to: the cook plan's serve time runs 16:00–22:45 (28
 * entries) and the planner's home time 17:00–22:45 (24). Only the arithmetic is
 * shared. Putting the window in the call is the whole point of the extraction —
 * `quarterHourOptions(16, 28)` beside `quarterHourOptions(17, 24)` shows the
 * difference where a reader will see it, instead of burying it inside
 * `16 + Math.floor(i / 4)` where nobody had (issue #1055).
 *
 * Making them one list would be a product change — the serve-time picker would
 * lose its 16:00–16:45, or the home-time picker would gain them — and is not
 * this function's call to make.
 */
export function quarterHourOptions(fromHour: number, count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, i) => `${fromHour + Math.floor(i / 4)}:${String((i % 4) * 15).padStart(2, '0')}`,
  );
}
