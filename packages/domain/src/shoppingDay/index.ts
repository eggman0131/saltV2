// Shopping-day module (issue #629). Pure, runtime-neutral helpers over the
// `shoppingDays/{YYYY-MM-DD}` collection — the planner's pre-shop shading
// predicate, the reminder's "tomorrow in zone" projection, and the one-shop-
// per-week reducer. No I/O, no clock (CLAUDE.md Rule 1); the doc shape itself
// lives in `@salt/domain/schemas`.
export { isBeforeShop } from './isBeforeShop.js';
export { dateInZone, addCalendarDays, tomorrowInZone } from './calendarDates.js';
export { shopDayForWeek } from './shopDayForWeek.js';
