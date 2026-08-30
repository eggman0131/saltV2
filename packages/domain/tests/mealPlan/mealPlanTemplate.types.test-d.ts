// Type-level test: the gap between what `MealPlanTemplateSchema` actually
// guarantees and what `MealPlanTemplate` claims — finding B3-007, pinned rather
// than described (issue #932).
//
// #932 recorded that converting this entity to `z.infer` would be "a no-op for
// B3-007, because z.infer['days'] is Record<Weekday, Day>, exactly as wrong as
// the interface". That is NOT true on the zod this repo resolves (3.25.x):
// `z.record(WeekdayEnum, …)` infers `Partial<Record<Weekday, Day>>` — already
// truthful. The lie lives entirely in the entity's narrowing and in the one
// surviving cast in mealPlanSync.ts, which together assert the parse's partial
// record into a total one for `instantiateWeek` to dereference unguarded.
//
// These assertions exist so B3-007 is discovered by a failing test rather than
// by reading a comment, and so the next person to touch either side is told
// which half they are changing.
import { describe, it, expectTypeOf } from 'vitest';
import type { MealPlanTemplate } from '@salt/domain';
import type { MealPlanTemplateDoc } from '@salt/domain/schemas';

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

describe('MealPlanTemplate vs MealPlanTemplateSchema (B3-007)', () => {
  it('the SCHEMA admits a template missing weekdays — the parse is partial', () => {
    expectTypeOf<Record<string, never>>().toExtend<MealPlanTemplateDoc['days']>();
  });

  it('the ENTITY claims every weekday is present — this is the lie B3-007 names', () => {
    expectTypeOf<MealPlanTemplate['days']>().toEqualTypeOf<
      Record<Weekday, MealPlanTemplate['days']['mon']>
    >();
  });

  it('so the entity does NOT accept the schema type — the gap is real, not stylistic', () => {
    expectTypeOf<MealPlanTemplateDoc['days']>().not.toExtend<MealPlanTemplate['days']>();
  });
});
