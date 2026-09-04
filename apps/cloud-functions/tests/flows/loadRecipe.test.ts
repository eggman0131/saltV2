import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked at the `firebase-admin/firestore` module boundary, exactly as the three
// flow suites are. That is what lets the flows adopt this helper without a single
// edit to their tests: a helper calling `getFirestore()` internally lands inside
// the mock they already install.
const { mockGet, mockDoc, mockCollection } = vi.hoisted(() => {
  const mockGet = vi.fn();
  // Typed, not inferred: this suite asserts on WHICH collection and document id
  // were asked for, and an inferred zero-argument mock records every call as an
  // empty tuple (#1135).
  const mockDoc = vi.fn<(id: string) => { get: typeof mockGet }>(() => ({ get: mockGet }));
  const mockCollection = vi.fn<(name: string) => { doc: typeof mockDoc }>(() => ({
    doc: mockDoc,
  }));
  return { mockGet, mockDoc, mockCollection };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));

const { requireRecipe, requireRecipeFrom, RECIPE_NOT_FOUND_MESSAGE, RECIPE_UNREADABLE_MESSAGE } =
  await import('../../src/flows/loadRecipe.js');

// A minimal document that really parses — every required field of RecipeSchema
// and nothing else, so a schema change that breaks the flows breaks this too.
const RECIPE = {
  id: 'recipe-1',
  schemaVersion: 1,
  kind: 'recipe',
  title: 'Overnight white tin',
  description: 'A slow loaf.',
  ingredients: [],
  steps: [{ id: 'step-1', text: 'Mix.', timer: null, note: null }],
  metadata: {
    servings: 1,
    tags: [],
  },
  source: null,
  notes: null,
  image: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

// The payload the three flow suites use for "stored recipe fails validation":
// an object (so it reaches the parse rather than stopping at `exists`) whose
// `schemaVersion` is 2 against RecipeSchema's `z.literal(1)`.
const UNREADABLE = { id: 'recipe-1', schemaVersion: 2 };

function snapshot(data: unknown): Parameters<typeof requireRecipeFrom>[0] {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
  } as unknown as Parameters<typeof requireRecipeFrom>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireRecipeFrom', () => {
  it('returns the parsed recipe for a document that reads', () => {
    const recipe = requireRecipeFrom(snapshot(RECIPE));
    expect(recipe.id).toBe('recipe-1');
    expect(recipe.title).toBe('Overnight white tin');
    // Parsed, not passed through: `producesCanonId` is defaulted by the schema
    // and is absent from the stored payload above.
    expect(recipe.producesCanonId).toBeNull();
  });

  it('throws not-found — with its message — when the document is absent', () => {
    // The code AND the string, neither of which the three flow suites ever
    // asserted. `classifyCallableError` has no arm for this code today (both
    // codes fall to the same default, and no call site passes an override), so
    // neither reaches the browser yet — but both are still CF-side contract:
    // the true answer at the point the failure happens, and pinned so a future
    // override has a stable code and message to key off.
    expect(() => requireRecipeFrom(snapshot(null))).toThrowError(
      expect.objectContaining({
        code: 'not-found',
        message: RECIPE_NOT_FOUND_MESSAGE,
      }),
    );
    expect(RECIPE_NOT_FOUND_MESSAGE).toBe("That recipe doesn't exist.");
  });

  it('throws failed-precondition — with its message — when the document fails RecipeSchema', () => {
    expect(() => requireRecipeFrom(snapshot(UNREADABLE))).toThrowError(
      expect.objectContaining({
        code: 'failed-precondition',
        message: RECIPE_UNREADABLE_MESSAGE,
      }),
    );
    expect(RECIPE_UNREADABLE_MESSAGE).toBe("That recipe can't be read.");
  });

  it('tells the two failures apart — a missing recipe is never "can\'t be read"', () => {
    // The distinction is the whole point of the helper: two codes reaching the
    // browser as two different sentences. A single collapsed `not-found` (as
    // `getImagePrompt` deliberately does) would pass every other case here.
    expect(RECIPE_NOT_FOUND_MESSAGE).not.toBe(RECIPE_UNREADABLE_MESSAGE);
  });

  it('reads nothing — the snapshot arrives already fetched', () => {
    requireRecipeFrom(snapshot(RECIPE));
    expect(mockCollection).not.toHaveBeenCalled();
  });
});

describe('requireRecipe', () => {
  it('reads recipes/{recipeId} and nothing else', async () => {
    mockGet.mockResolvedValue(snapshot(RECIPE));

    const recipe = await requireRecipe('recipe-1');

    expect(recipe.id).toBe('recipe-1');
    expect(mockCollection.mock.calls.map((c) => c[0])).toEqual(['recipes']);
    expect(mockDoc.mock.calls.map((c) => c[0])).toEqual(['recipe-1']);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('throws not-found for an id that names nothing', async () => {
    mockGet.mockResolvedValue(snapshot(null));
    await expect(requireRecipe('nope')).rejects.toMatchObject({
      code: 'not-found',
      message: RECIPE_NOT_FOUND_MESSAGE,
    });
  });

  it('throws failed-precondition for a stored recipe that fails validation', async () => {
    mockGet.mockResolvedValue(snapshot(UNREADABLE));
    await expect(requireRecipe('recipe-1')).rejects.toMatchObject({
      code: 'failed-precondition',
      message: RECIPE_UNREADABLE_MESSAGE,
    });
  });
});
