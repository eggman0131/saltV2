import type { Day } from './Day.js';

// One concrete week. `id` equals `startDate` (the YYYY-MM-DD of the week's start
// day) and doubles as the Firestore document key. `days` is keyed by the seven
// concrete YYYY-MM-DD dates. Whole-document last-write-wins.
export interface MealPlanWeek {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly startDate: string;
  readonly days: Readonly<Record<string, Day>>;
  readonly updatedAt: string; // ISO-8601; stamped by the service on save
}
