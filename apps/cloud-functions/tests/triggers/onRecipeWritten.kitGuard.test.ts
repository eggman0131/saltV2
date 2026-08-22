import { describe, it, expect, vi } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { RecipeDoc } from '@salt/domain/schemas';

// The edge-trigger guard for the kit branch (issue #882). Like the product-form
// icon guard these pin the TRANSITIONS, not the states, and for the same reason:
// the trigger fires on every write and recipes are re-saved constantly, so a guard
// that read only the current document would pay for an inference again and again.
//
// Two failures are specifically nailed down here because both cost real money and
// neither shows up as a broken screen — they show up as a bill:
//
//   1. An unrelated save landing WHILE an inference is in flight. An import writes
//      the recipe and then canonicalises its ingredients seconds later, and at that
//      moment the stamp is still absent because the first inference has not
//      returned. Reading "no stamp" as "ask" starts a duplicate.
//   2. The branch's OWN write-back re-firing the trigger. It stamps `kitInferredAt`,
//      and if the same write also deleted `kitRequestedAt` the guard would see the
//      nonce change from `N` to absent and infer a second time — doubling the cost
//      of every redo.

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

const { kitNeedsInference } = await import('../../src/triggers/onRecipeWritten.js');

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

describe('onRecipeWritten — kitNeedsInference', () => {
  it('infers on create, when nothing has ever been asked', () => {
    expect(kitNeedsInference(undefined, recipe())).toBe(true);
    expect(kitNeedsInference(snapshot(null), recipe())).toBe(true);
  });

  it('skips once the answer is stamped', () => {
    const after = recipe({ kitInferredAt: 1_700_000_000_000 });
    expect(kitNeedsInference(snapshot({}), after)).toBe(false);
    // An unrelated edit to a recipe that already has its kit must not re-ask.
    expect(kitNeedsInference(snapshot({ kitInferredAt: 1_699_000_000_000 }), after)).toBe(false);
  });

  it('does NOT start a duplicate while the first inference is still in flight', () => {
    // The canonicalise pass landing seconds after create: no stamp before, no stamp
    // after, nothing else about the kit changed. The write that first left it
    // unstamped owns the inference.
    expect(kitNeedsInference(snapshot({ title: 'Ragu' }), recipe())).toBe(false);
  });

  it('infers when a redo clears the stamp and bumps the nonce together', () => {
    const before = snapshot({ kitInferredAt: 1_700_000_000_000 });
    expect(kitNeedsInference(before, recipe({ kitRequestedAt: 1_700_000_001_000 }))).toBe(true);
  });

  it('infers on a redo of a recipe whose last inference FAILED (no stamp to clear)', () => {
    // Nothing to delete, so the nonce is the only thing that makes the write real.
    const before = snapshot({ kitRequestedAt: 1_700_000_000_000 });
    expect(kitNeedsInference(before, recipe({ kitRequestedAt: 1_700_000_009_000 }))).toBe(true);
  });

  it('does not re-infer on its own write-back, which leaves the nonce in place', () => {
    // The branch stamps `kitInferredAt` and deliberately does NOT delete
    // `kitRequestedAt`. Deleting it would read as a nonce change here and buy a
    // second inference for every redo.
    const before = snapshot({ kitRequestedAt: 1_700_000_001_000 });
    const after = recipe({ kitRequestedAt: 1_700_000_001_000, kitInferredAt: 1_700_000_002_000 });
    expect(kitNeedsInference(before, after)).toBe(false);
  });
});
