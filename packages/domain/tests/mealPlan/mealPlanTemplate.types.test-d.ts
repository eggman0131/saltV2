// Type-level test: `MealPlanTemplate` and `MealPlanTemplateSchema` agree about
// whether a weekday can be missing. They did not until issue #1056 — the entity
// narrowed `days` back to a total record, and one cast in `mealPlanSync.ts`
// asserted the parse's partial map into it, which was finding B3-007.
//
// `z.record(WeekdayEnum, …)` validates an open enum-keyed map and zod (3.25.x
// here) infers `Partial<Record<Weekday, Day>>`. The entity now takes that
// inference verbatim. A runtime assertion cannot see any of this, which is why
// it is pinned here rather than in the schema suite beside it.
import { describe, it, expectTypeOf } from 'vitest';
import type { MealPlanTemplate } from '@salt/domain';
import type { MealPlanTemplateDoc } from '@salt/domain/schemas';

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type Day = NonNullable<MealPlanTemplate['days']['mon']>;

describe('MealPlanTemplate vs MealPlanTemplateSchema (#1056)', () => {
  it('the SCHEMA admits a template missing weekdays — the parse is partial', () => {
    expectTypeOf<Record<string, never>>().toExtend<MealPlanTemplateDoc['days']>();
  });

  it('the ENTITY admits it too — every weekday is optional, not required', () => {
    expectTypeOf<MealPlanTemplate['days']>().toEqualTypeOf<Partial<Record<Weekday, Day>>>();
  });

  it('so the entity accepts the schema type exactly, with no narrowing between them', () => {
    expectTypeOf<MealPlanTemplateDoc>().toEqualTypeOf<MealPlanTemplate>();
  });

  it('reading a weekday yields Day | undefined, which is what forces the guard', () => {
    expectTypeOf<MealPlanTemplate['days']['mon']>().toEqualTypeOf<Day | undefined>();
  });
});
