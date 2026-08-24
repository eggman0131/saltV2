import { describe, it, expect } from 'vitest';
import { cookShape, emptyRecipe, newStep, OTHER_WAITS_LABEL } from '@salt/domain';
import type { Recipe, RecipeMetadata, Step } from '@salt/domain';
import { UNNAMED_WAIT_LABEL } from '../../src/recipe/index.js';

const ISO = '2026-01-01T00:00:00.000Z';

function timed(id: string, minutes: number, description: string | null): Step {
  return { ...newStep(id, `step ${id}`), timer: { durationMinutes: minutes, description } };
}

function recipe(steps: Step[], metadata: Partial<RecipeMetadata> = {}): Recipe {
  const base = emptyRecipe('r-1', ISO);
  return { ...base, steps, metadata: { ...base.metadata, ...metadata } };
}

describe('cookShape', () => {
  it('is null when no step carries a timer — the ribbon is absent, not empty', () => {
    expect(cookShape(recipe([newStep('s-1', 'Chop'), newStep('s-2', 'Fry')]))).toBeNull();
  });

  it('is null for a kind with no method at all — no capability check needed', () => {
    expect(cookShape(recipe([]))).toBeNull();
  });

  it('ignores a zero-length timer, which tells us nothing about where time goes', () => {
    expect(cookShape(recipe([timed('s-1', 0, 'Rest')]))).toBeNull();
  });

  it('answers the brisket question: 22 hours long, 40 minutes of work', () => {
    const shape = cookShape(
      recipe([timed('s-1', 720, 'Brine'), timed('s-2', 560, 'Slow-cook')], {
        totalTimeMinutes: 1320,
        prepTimeMinutes: 40,
      }),
    );

    expect(shape).not.toBeNull();
    expect(shape?.waitingMinutes).toBe(1280);
    expect(shape?.handsOnMinutes).toBe(40);
    expect(shape?.totalMinutes).toBe(1320);
    expect(shape?.segments).toEqual([
      { kind: 'hands-on', label: 'Hands-on', minutes: 40 },
      { kind: 'wait', label: 'Brine', minutes: 720 },
      { kind: 'wait', label: 'Slow-cook', minutes: 560 },
    ]);
  });

  it('still produces a shape when every timer is short', () => {
    const shape = cookShape(
      recipe([timed('s-1', 5, 'Simmer'), timed('s-2', 3, 'Rest')], {
        totalTimeMinutes: 20,
        prepTimeMinutes: 12,
      }),
    );

    expect(shape?.totalMinutes).toBe(20);
    expect(shape?.waitingMinutes).toBe(8);
    expect(shape?.handsOnMinutes).toBe(12);
    expect(shape?.segments).toHaveLength(3);
  });

  it('sums timers that share a label, keeping the first spelling the author used', () => {
    const shape = cookShape(
      recipe([timed('s-1', 10, 'Prove'), timed('s-2', 20, 'prove'), timed('s-3', 15, 'Bake')]),
    );

    expect(shape?.segments).toEqual([
      { kind: 'wait', label: 'Prove', minutes: 30 },
      { kind: 'wait', label: 'Bake', minutes: 15 },
    ]);
  });

  it('names a timer with no description of its own', () => {
    const shape = cookShape(recipe([timed('s-1', 30, null), timed('s-2', 10, '  ')]));
    expect(shape?.segments).toEqual([{ kind: 'wait', label: UNNAMED_WAIT_LABEL, minutes: 40 }]);
  });

  it('keeps the three biggest waits by name, in method order, and folds the rest', () => {
    const shape = cookShape(
      recipe([
        timed('s-1', 5, 'Rest'),
        timed('s-2', 100, 'Brine'),
        timed('s-3', 7, 'Cool'),
        timed('s-4', 60, 'Roast'),
        timed('s-5', 30, 'Prove'),
      ]),
    );

    expect(shape?.waitingMinutes).toBe(202);
    // Brine / Roast / Prove survive on size; they are drawn in the order the
    // method reaches them, and Rest + Cool merge into the remainder.
    expect(shape?.segments).toEqual([
      { kind: 'wait', label: 'Brine', minutes: 100 },
      { kind: 'wait', label: 'Roast', minutes: 60 },
      { kind: 'wait', label: 'Prove', minutes: 30 },
      { kind: 'wait', label: OTHER_WAITS_LABEL, minutes: 12 },
    ]);
  });

  it('prefers total-minus-waiting over prep, because hands-on is more than chopping', () => {
    const shape = cookShape(
      recipe([timed('s-1', 45, 'Simmer')], {
        totalTimeMinutes: 90,
        prepTimeMinutes: 15,
      }),
    );

    expect(shape?.handsOnMinutes).toBe(45);
  });

  it('falls back to prep when the recorded total is smaller than the timers it contains', () => {
    const shape = cookShape(
      recipe([timed('s-1', 120, 'Braise')], {
        totalTimeMinutes: 60,
        prepTimeMinutes: 15,
      }),
    );

    expect(shape?.handsOnMinutes).toBe(15);
    expect(shape?.totalMinutes).toBe(135);
  });

  it('falls back to zero, and drops the hands-on segment, for a dish that is only waiting', () => {
    const shape = cookShape(recipe([timed('s-1', 480, 'Ferment')]));

    expect(shape?.handsOnMinutes).toBe(0);
    expect(shape?.totalMinutes).toBe(480);
    expect(shape?.segments).toEqual([{ kind: 'wait', label: 'Ferment', minutes: 480 }]);
  });

  it('always adds up: the segments sum to the total', () => {
    const shape = cookShape(
      recipe(
        [timed('s-1', 5, 'a'), timed('s-2', 11, 'b'), timed('s-3', 3, 'c'), timed('s-4', 9, 'd')],
        {
          totalTimeMinutes: 60,
        },
      ),
    );

    const sum = shape?.segments.reduce((total, segment) => total + segment.minutes, 0);
    expect(sum).toBe(shape?.totalMinutes);
  });
});
