import type { Weekday } from './Weekday.js';

// Singleton config. `firstDayOfWeek` is the "big shop" day that starts each
// week — a global layout setting kept separate from the template.
export interface MealPlanConfig {
  readonly firstDayOfWeek: Weekday;
  readonly schemaVersion: 1;
}
