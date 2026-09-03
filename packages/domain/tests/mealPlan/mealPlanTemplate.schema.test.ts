// What `MealPlanTemplateSchema` actually accepts and rejects, pinned (issue
// #1056). There was no test file for this schema before, which is how the
// entity beside it came to claim a total weekday map the parse never enforced.
//
// The point of these cases is that the accept set must NOT be narrowed. This is
// the read boundary for a production collection, and its failure mode is silent:
// `subscribeMealPlanTemplate` reads it with `onCorrupt: 'error'` and
// `logsRejection: false`, and `mealPlanService` swallows the resulting
// `Failure`. Requiring the seven weekdays here would make a partial document
// fail to parse, leaving the store `null`, which the service reads as "no
// template" — so Load template would silently overwrite the week with seven
// blank days and nothing would be logged anywhere.
import { describe, it, expect } from 'vitest';
import { MealPlanTemplateSchema } from '@salt/domain/schemas';

const day = { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0 };

describe('MealPlanTemplateSchema', () => {
  it('accepts all seven weekdays', () => {
    const days = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((wd) => [wd, day]),
    );
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 1, days }).success).toBe(true);
  });

  it('accepts a template holding only some weekdays', () => {
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 1, days: { mon: day } }).success).toBe(
      true,
    );
  });

  it('accepts a template holding no weekdays at all', () => {
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 1, days: {} }).success).toBe(true);
  });

  it('completes a day from its per-field defaults', () => {
    const parsed = MealPlanTemplateSchema.safeParse({ schemaVersion: 1, days: { mon: {} } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.days.mon).toEqual(day);
  });

  it('rejects a key outside the weekday enum', () => {
    // The record form is what gives this rejection. A seven-key
    // `z.object(…).partial()` would strip `zzz` silently instead.
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 1, days: { zzz: day } }).success).toBe(
      false,
    );
  });

  it('rejects a schemaVersion other than 1', () => {
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 2, days: {} }).success).toBe(false);
  });

  it('rejects a missing days map', () => {
    expect(MealPlanTemplateSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });
});
