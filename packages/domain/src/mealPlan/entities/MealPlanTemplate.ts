import type { MealPlanTemplateDoc } from '../../schemas/mealPlanTemplate.js';

// The standard week, keyed by weekday. Loaded into any concrete week via
// instantiateWeek and then tweaked. Schema-first (issue #932) — and, since
// issue #1056, an unnarrowed alias of what the schema actually validates.
//
// `days` is PARTIAL, not total. `MealPlanTemplateSchema.days` is
// `z.record(WeekdayEnum, MealPlanDaySchema)`, which validates an open map that
// merely rejects keys outside the enum: `{ days: {} }` and `{ days: { mon } }`
// both parse. zod (>= 3.23; this repo resolves 3.25.x) infers that as
// `Partial<Record<Weekday, Day>>`, and this type now takes that inference
// verbatim. It previously narrowed `days` back to a total record — a claim the
// parse never made, which is what issue #1056 fixed.
//
// So a stored template need not carry every weekday, and the two commands that
// index it (`instantiateWeek`, `dayMutators.withDay`) treat a missing weekday as
// a blank day rather than dereferencing `undefined`. The schema's accept/reject
// set is unchanged by #1056: every document that parsed before parses now.
export type MealPlanTemplate = MealPlanTemplateDoc;
