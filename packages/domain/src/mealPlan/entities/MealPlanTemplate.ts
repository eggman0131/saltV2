import type { Weekday } from './Weekday.js';
import type { Day } from './Day.js';

// The standard week, keyed by weekday. Loaded into any concrete week via
// instantiateWeek and then tweaked.
export interface MealPlanTemplate {
  readonly schemaVersion: 1;
  readonly days: Readonly<Record<Weekday, Day>>;
}
