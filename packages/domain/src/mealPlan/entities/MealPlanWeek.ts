import type { MealPlanWeekDoc } from '../../schemas/mealPlanWeek.js';
import type { Day } from './Day.js';

// One concrete week. `id` equals `startDate` (the YYYY-MM-DD of the week's start
// day) and doubles as the Firestore document key. `days` is keyed by the seven
// concrete YYYY-MM-DD dates. Whole-document last-write-wins. `updatedAt` is
// ISO-8601, stamped by the service on save. Schema-first (issue #932), with
// `days` kept as a `Readonly<>` record — deliberately, and not for immutability.
//
// `dayMutators.ts` is generic over the key type so one implementation serves
// both a date-keyed week and a weekday-keyed template, via
// `DayContainer<K> = { readonly days: Readonly<Record<K, Day>> }`. A week's key
// space is open (any date string), so satisfying that constraint for a literal
// key like '2026-08-06' relies on TypeScript accepting a homomorphic
// `Readonly<>` mapping over a string index signature. The bare
// `Record<string, Day>` that `z.infer` produces does NOT satisfy it, and every
// `setDayNote`/`setDayRecipes` call on a week stops compiling. So the
// `Readonly<>` here is load-bearing for the shared mutator abstraction, not a
// leftover of the deep-readonly entities issue #417 gave up.
export type MealPlanWeek = Omit<MealPlanWeekDoc, 'days'> & {
  days: Readonly<Record<string, Day>>;
};
