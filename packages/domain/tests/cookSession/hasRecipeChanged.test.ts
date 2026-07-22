import { describe, it, expect } from 'vitest';
import { hasRecipeChanged } from '@salt/domain';
import type { CookSessionDoc } from '@salt/domain/schemas';

// Did the recipe drift under an in-progress cook (issue #556)? A plain string
// comparison against the baseline snapshotted when the session started. Drives
// the "recipe was updated" banner and its Restart.

const BASELINE = '2026-07-01T09:00:00.000Z';

function session(recipeUpdatedAtAtStart = BASELINE): CookSessionDoc {
  return {
    id: 'r1_u1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: 'r1',
    recipeUpdatedAtAtStart,
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers: [],
    createdAt: '2026-07-22T18:30:00.000Z',
    updatedAt: '2026-07-22T18:30:00.000Z',
  };
}

describe('hasRecipeChanged', () => {
  it('is false when the live recipe still matches the baseline', () => {
    expect(hasRecipeChanged(session(), BASELINE)).toBe(false);
  });

  it('is true when the live recipe has been written since', () => {
    expect(hasRecipeChanged(session(), '2026-07-22T20:00:00.000Z')).toBe(true);
  });

  it('is true for a recipe timestamp EARLIER than the baseline', () => {
    // Direction is not the question — any difference means the cook's copy of
    // the instructions is stale in a way this comparison cannot characterise.
    expect(hasRecipeChanged(session(), '2026-06-01T09:00:00.000Z')).toBe(true);
  });

  // ─── Still loading, or the recipe was deleted → never a change ──────────────
  // The banner must not flash while the stores resolve.
  const absent: Array<[string, CookSessionDoc | null | undefined, string | null | undefined]> = [
    ['the session is null', null, BASELINE],
    ['the session is undefined', undefined, BASELINE],
    ['the recipe timestamp is null', session(), null],
    ['the recipe timestamp is undefined', session(), undefined],
    ['both are absent', null, null],
  ];

  it.each(absent)('is false when %s', (_label, s, updatedAt) => {
    expect(hasRecipeChanged(s, updatedAt)).toBe(false);
  });

  it('compares an empty baseline as a real value, not as absent', () => {
    // A degenerate-but-present timestamp is still a comparison, unlike null.
    expect(hasRecipeChanged(session(''), BASELINE)).toBe(true);
    expect(hasRecipeChanged(session(''), '')).toBe(false);
  });

  it('is exact — no tolerance, no parsing', () => {
    // Equivalent instants written differently still read as a change; the field
    // is always produced by the same `toISOString()` path, so this never bites
    // in practice and keeps the comparison free of date parsing.
    expect(hasRecipeChanged(session('2026-07-01T09:00:00.000Z'), '2026-07-01T09:00:00Z')).toBe(
      true,
    );
  });

  it('is pure — does not mutate the session', () => {
    const s = session();
    hasRecipeChanged(s, '2026-07-22T20:00:00.000Z');
    expect(s.recipeUpdatedAtAtStart).toBe(BASELINE);
  });
});
