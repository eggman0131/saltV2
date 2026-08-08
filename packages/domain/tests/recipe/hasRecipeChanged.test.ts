import { describe, it, expect } from 'vitest';
import { hasRecipeChanged } from '@salt/domain';

// Did the recipe drift under something built from it? A plain string comparison
// against the baseline the artefact snapshotted. Two callers, two field names,
// one comparison (issue #751): a cook session's `recipeUpdatedAtAtStart` (#556)
// drives the "recipe was updated" banner and its Restart, and a guided plan's
// `recipeUpdatedAtAtSave` drives "the recipe has changed since this plan was
// written" and its re-run. The function sees only the two timestamps.

const BASELINE = '2026-07-01T09:00:00.000Z';

describe('hasRecipeChanged', () => {
  it('is false when the live recipe still matches the baseline', () => {
    expect(hasRecipeChanged(BASELINE, BASELINE)).toBe(false);
  });

  it('is true when the live recipe has been written since', () => {
    expect(hasRecipeChanged(BASELINE, '2026-07-22T20:00:00.000Z')).toBe(true);
  });

  it('is true for a recipe timestamp EARLIER than the baseline', () => {
    // Direction is not the question — any difference means the artefact's copy of
    // the recipe is stale in a way this comparison cannot characterise.
    expect(hasRecipeChanged(BASELINE, '2026-06-01T09:00:00.000Z')).toBe(true);
  });

  // ─── Still loading, or the recipe was deleted → never a change ──────────────
  // The banner must not flash while the stores resolve. Absence on EITHER side
  // means there is nothing to compare: no artefact yet, or no recipe yet.
  const absent: Array<[string, string | null | undefined, string | null | undefined]> = [
    ['the baseline is null', null, BASELINE],
    ['the baseline is undefined', undefined, BASELINE],
    ['the recipe timestamp is null', BASELINE, null],
    ['the recipe timestamp is undefined', BASELINE, undefined],
    ['both are absent', null, null],
  ];

  it.each(absent)('is false when %s', (_label, stamped, updatedAt) => {
    expect(hasRecipeChanged(stamped, updatedAt)).toBe(false);
  });

  it('compares an empty baseline as a real value, not as absent', () => {
    // A degenerate-but-present timestamp is still a comparison, unlike null.
    expect(hasRecipeChanged('', BASELINE)).toBe(true);
    expect(hasRecipeChanged('', '')).toBe(false);
  });

  it('is exact — no tolerance, no parsing', () => {
    // Equivalent instants written differently still read as a change; the field
    // is always produced by the same `toISOString()` path, so this never bites
    // in practice and keeps the comparison free of date parsing.
    expect(hasRecipeChanged('2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00Z')).toBe(true);
  });

  it('is pure — reads its arguments and nothing else', () => {
    // Nothing to mutate now that it takes two strings; the property that mattered
    // (the caller's snapshot survives the call) holds by construction.
    const stamped = BASELINE;
    hasRecipeChanged(stamped, '2026-07-22T20:00:00.000Z');
    expect(stamped).toBe(BASELINE);
  });
});
