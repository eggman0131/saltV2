import type { MealPlanTemplateDoc } from '../../schemas/mealPlanTemplate.js';
import type { Weekday } from './Weekday.js';
import type { Day } from './Day.js';

// The standard week, keyed by weekday. Loaded into any concrete week via
// instantiateWeek and then tweaked. Schema-first (issue #932) — but `days` is
// narrowed back to a TOTAL record, and that narrowing is deliberate.
//
// `MealPlanTemplateSchema.days` is `z.record(WeekdayEnum, MealPlanDaySchema)`,
// which zod infers as `Partial<Record<Weekday, Day>>` (zod >= 3.23; this repo
// resolves 3.25.x). Taking that inference would widen this type to admit a
// template missing weekdays — which is TRUE of the parse, and is exactly
// finding B3-007. But acting on it is a behavior change: `instantiateWeek`
// dereferences `template.days[weekdayOf(date)]` unguarded, so the truthful type
// forces a guard, and a guard changes what instantiateWeek does for a partial
// template. B3-007 is split out of #932 for that reason, and #932's Phase 3 must
// not touch instantiateWeek.
//
// So this preserves today's type exactly. Stated with its real boundary rather
// than as a guarantee: this record is total because every writer writes all
// seven days, NOT because the schema enforces it — the parse admits fewer, and
// a template stored with a missing weekday would make this type a lie. That is
// B3-007's to fix, together with the guard.
//
// NOTE for whoever takes B3-007: #932 recorded this conversion as "a no-op for
// that defect, because z.infer is Record<Weekday, Day>, exactly as wrong as the
// interface". That is not true on the resolved zod — the inference is already
// `Partial`, so the type half of B3-007 needs no schema work at all; only the
// `instantiateWeek` guard and this narrowing's removal remain.
export type MealPlanTemplate = Omit<MealPlanTemplateDoc, 'days'> & {
  days: Record<Weekday, Day>;
};
