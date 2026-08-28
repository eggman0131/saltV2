import { describe, it, expect, vi } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { RecipeDoc } from '@salt/domain/schemas';

// The edge-trigger guard for the time re-estimate branch (issue #952, phase 2).
//
// It is the narrowest of the three guards in onRecipeWritten, and the tests below
// exist to keep it that way. The expensive mistake here is not a missing estimate
// — the backfill script can always be re-run — it is an estimate that fires on
// writes nobody asked about. Two shapes would each do that, and both look
// reasonable until you count the AI calls:
//
//   1. Firing on CREATE, as the kit branch does. Every recipe authored from now on
//      already has its times answered against the definition in recipeFieldRules,
//      by the very path that just wrote it. Re-asking would buy a second AI call
//      per recipe, forever, to second-guess a number that is already right.
//   2. Firing whenever `timesEstimatedAt` is absent. Every recipe in the library
//      predating this issue is permanently unstamped, so an unrelated save of one
//      — canonicalise, per-row rematch, an edit, "apply changes", each a
//      whole-document `setDoc` — would fire an AI call. Forever, and for free from
//      the user's point of view.
//
// The nonce is what gates the branch; the stamp exists for the script.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => '' }) }));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { delete: () => 'DELETE' },
}));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({}) }));

const { timesNeedEstimate } = await import('../../src/triggers/onRecipeWritten.js');

function recipe(overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return { id: 'r1', kind: 'recipe', kit: [], ...overrides } as unknown as RecipeDoc;
}

/** A minimal stand-in for the `before` snapshot: only `exists` and `data()` are read. */
function snapshot(data: Record<string, unknown> | null): DocumentSnapshot {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
  } as unknown as DocumentSnapshot;
}

describe('onRecipeWritten — timesNeedEstimate', () => {
  it('does NOT estimate on create — the authoring path just answered the same question', () => {
    expect(timesNeedEstimate(undefined, recipe())).toBe(false);
    expect(timesNeedEstimate(snapshot(null), recipe())).toBe(false);
  });

  it('does NOT estimate merely because the recipe has never been backfilled', () => {
    // Every pre-#952 recipe looks like this on every unrelated save.
    const after = recipe();
    expect(timesNeedEstimate(snapshot({ title: 'before' }), after)).toBe(false);
  });

  it('estimates when the request nonce is bumped', () => {
    const after = recipe({ timesRequestedAt: 1_700_000_000_000 });
    expect(timesNeedEstimate(snapshot({}), after)).toBe(true);
  });

  it('estimates again when an ALREADY-stamped recipe is asked a second time', () => {
    // `--redo` on the script. The stamp does not gate the branch, so a deliberate
    // second pass after a change to the definition costs one nonce bump.
    const after = recipe({
      timesRequestedAt: 1_700_000_001_000,
      timesEstimatedAt: 1_699_000_000_000,
    });
    const before = snapshot({
      timesRequestedAt: 1_700_000_000_000,
      timesEstimatedAt: 1_699_000_000_000,
    });
    expect(timesNeedEstimate(before, after)).toBe(true);
  });

  it('does not re-fire on its own write-back', () => {
    // The branch stamps `timesEstimatedAt` and leaves the nonce in place; that
    // write re-fires the trigger, and the guard must see an unchanged nonce and
    // stop. Deleting the nonce instead would read as a change here and buy a
    // second estimate for every request — the trap the kit branch documents.
    const nonce = 1_700_000_000_000;
    const before = snapshot({ timesRequestedAt: nonce });
    const after = recipe({ timesRequestedAt: nonce, timesEstimatedAt: Date.now() });
    expect(timesNeedEstimate(before, after)).toBe(false);
  });

  it('does not re-fire on an unrelated save that lands while an estimate is in flight', () => {
    // An import canonicalising its ingredients seconds after the request. The
    // nonce is unchanged, so this must not start a duplicate.
    const nonce = 1_700_000_000_000;
    const before = snapshot({ timesRequestedAt: nonce });
    const after = recipe({ timesRequestedAt: nonce, title: 'edited' });
    expect(timesNeedEstimate(before, after)).toBe(false);
  });
});
