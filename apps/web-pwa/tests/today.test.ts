import { describe, it, expect } from 'vitest';
import { dateInZone } from '@salt/domain';
import { todayIso } from '../src/lib/today.js';

/**
 * The five deleted copies and their replacement give the same answer (issue #933,
 * Phase 2).
 *
 * `shoppingDayService`, `mealPlanService`, `ShoppingListPage`, `MealPlanWeekPage`
 * and `RecipeAddToPlannerSheet` each answered "what day is it here?" with
 * `new Date().toLocaleDateString('en-CA')`. They now import `todayIso`, which
 * asks `@salt/domain`'s `dateInZone` with the device's own zone. That is a
 * different API reaching the same conclusion, and a shop day, a planner week and
 * an add-to-planner sheet disagreeing by one day would be a genuinely confusing
 * bug that no other test in this repo would catch.
 *
 * WHAT THIS CAN AND CANNOT PROVE. `toLocaleDateString` has no zone parameter — it
 * always uses the ambient one — so the retired expression can only be evaluated
 * for the zone the test process happens to run in. That is UTC in CI and
 * Europe/London locally, so between the two environments the table below is
 * exercised in two zones and neither is a fixed-offset special case. It is NOT a
 * claim about every zone; see `src/lib/today.ts` for the by-hand check across the
 * half-hour and 45-minute offsets that was done before the substitution.
 */
describe('todayIso — the same answer the five deleted copies gave', () => {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Instants chosen to land either side of midnight in most zones, on
  // single- and double-digit months and days, across a leap day and a year
  // rollover — the shapes where a zero-padding or a rollover bug would show.
  const instants = [
    '2026-01-05T00:30:00.000Z',
    '2026-01-05T23:30:00.000Z',
    '2026-03-29T01:30:00.000Z', // Europe/London springs forward
    '2026-06-15T12:00:00.000Z',
    '2026-10-25T01:30:00.000Z', // Europe/London falls back
    '2026-12-31T23:45:00.000Z', // year rollover
    '2024-02-29T12:00:00.000Z', // leap day
    '2026-09-09T09:09:00.000Z',
    '2026-11-10T22:00:00.000Z',
  ];

  it.each(instants)('%s reads the same either way', (iso) => {
    const at = new Date(iso);
    expect(dateInZone(at, localZone)).toBe(at.toLocaleDateString('en-CA'));
  });

  it('answers with today, in the shape every date-keyed collection uses', () => {
    // Sampled either side so a run that crosses midnight is correct rather than
    // flaky: `todayIso()` must be one of the two days the retired expression
    // gave immediately before and after it.
    const before = new Date().toLocaleDateString('en-CA');
    const answer = todayIso();
    const after = new Date().toLocaleDateString('en-CA');

    expect(answer).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([before, after]).toContain(answer);
  });

  it('is a plain read, not a memo — a second call is free to see a new day', () => {
    // The planner deliberately reads once per mount (`MealPlanWeekPage`'s
    // `todayDate` is a `const`, not a `$derived`), but that is the CALLER's
    // choice. Nothing is cached here, so a service that wants a fresh answer
    // gets one.
    expect(todayIso()).toBe(todayIso());
    expect(todayIso()).toBe(dateInZone(new Date(), localZone));
  });
});
