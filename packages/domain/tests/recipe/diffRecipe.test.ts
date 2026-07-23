import { describe, it, expect } from 'vitest';
import { diffRecipe, emptyRecipe, newIngredient, newStep } from '@salt/domain';
import type { Recipe, Ingredient, Step } from '@salt/domain';
import type { RecipeDiff } from '@salt/domain/schemas';

const ISO = '2026-01-01T00:00:00.000Z';

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return { ...emptyRecipe('r-1', ISO), ...overrides };
}

// Put a flat list of ingredients into a single unnamed group.
function withIngredients(base: Recipe, items: Ingredient[]): Recipe {
  return { ...base, ingredients: [{ id: 'g-1', name: null, items }] };
}

function withSteps(base: Recipe, steps: Step[]): Recipe {
  return { ...base, steps };
}

function withMetadata(base: Recipe, metadata: Partial<Recipe['metadata']>): Recipe {
  return { ...base, metadata: { ...base.metadata, ...metadata } };
}

describe('diffRecipe', () => {
  it('reports no changes for an identical recipe (no-op)', () => {
    const r = withSteps(
      withIngredients(recipe({ title: 'Soup', description: 'Warm', notes: 'Family fave' }), [
        newIngredient('i-1', '200g carrots'),
      ]),
      [newStep('s-1', 'Chop the carrots')],
    );
    const diff = diffRecipe(r, structuredClone(r));
    expect(diff.hasChanges).toBe(false);
    expect(diff.title).toBeUndefined();
    expect(diff.description).toBeUndefined();
    expect(diff.notes).toBeUndefined();
    expect(diff.ingredients).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.steps).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.metadata).toEqual({});
    expect(diff.tags).toEqual({ added: [], removed: [] });
  });

  it('detects a title rename', () => {
    const before = recipe({ title: 'Tomato Soup' });
    const after = recipe({ title: 'Roasted Tomato Soup' });
    const diff = diffRecipe(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.title).toEqual({ from: 'Tomato Soup', to: 'Roasted Tomato Soup' });
  });

  it('detects a description change including null → string and back', () => {
    expect(
      diffRecipe(recipe({ description: null }), recipe({ description: 'New' })).description,
    ).toEqual({ from: null, to: 'New' });
    expect(
      diffRecipe(recipe({ description: 'Old' }), recipe({ description: null })).description,
    ).toEqual({ from: 'Old', to: null });
    expect(
      diffRecipe(recipe({ description: 'Same' }), recipe({ description: 'Same' })).description,
    ).toBeUndefined();
  });

  it('detects a notes change', () => {
    const diff = diffRecipe(recipe({ notes: null }), recipe({ notes: 'Season well' }));
    expect(diff.notes).toEqual({ from: null, to: 'Season well' });
  });

  it('detects an added ingredient', () => {
    const before = withIngredients(recipe(), [newIngredient('i-1', 'double cream')]);
    const after = withIngredients(recipe(), [
      newIngredient('i-1', 'double cream'),
      newIngredient('i-2', '200g crème fraîche'),
    ]);
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.added).toEqual([{ id: 'i-2', rawText: '200g crème fraîche' }]);
    expect(diff.ingredients.removed).toEqual([]);
    expect(diff.ingredients.changed).toEqual([]);
    expect(diff.hasChanges).toBe(true);
  });

  it('detects a removed ingredient', () => {
    const before = withIngredients(recipe(), [
      newIngredient('i-1', 'double cream'),
      newIngredient('i-2', 'butter'),
    ]);
    const after = withIngredients(recipe(), [newIngredient('i-2', 'butter')]);
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.removed).toEqual([{ id: 'i-1', rawText: 'double cream' }]);
    expect(diff.ingredients.added).toEqual([]);
  });

  it('detects a changed ingredient (same id reused, rawText reworded)', () => {
    const before = withIngredients(recipe(), [newIngredient('i-1', '2 cloves garlic')]);
    const after = withIngredients(recipe(), [newIngredient('i-1', '3 cloves garlic')]);
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.changed).toEqual([
      { id: 'i-1', from: '2 cloves garlic', to: '3 cloves garlic' },
    ]);
    expect(diff.ingredients.added).toEqual([]);
    expect(diff.ingredients.removed).toEqual([]);
  });

  it('flattens ingredients across groups for the item-level diff', () => {
    const before: Recipe = {
      ...recipe(),
      ingredients: [
        { id: 'g-1', name: 'Sauce', items: [newIngredient('i-1', 'passata')] },
        { id: 'g-2', name: 'Base', items: [newIngredient('i-2', 'flour')] },
      ],
    };
    const after: Recipe = {
      ...recipe(),
      ingredients: [
        { id: 'g-1', name: 'Sauce', items: [newIngredient('i-1', 'passata')] },
        // 'flour' moved to a differently-named group but same id + rawText → no change
        {
          id: 'g-3',
          name: 'Dough',
          items: [newIngredient('i-2', 'flour'), newIngredient('i-3', 'yeast')],
        },
      ],
    };
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.added).toEqual([{ id: 'i-3', rawText: 'yeast' }]);
    expect(diff.ingredients.removed).toEqual([]);
    expect(diff.ingredients.changed).toEqual([]);
  });

  it('distinguishes id-reuse (edit) from a genuinely new item', () => {
    // Same id, different text → an edit (changed), not remove+add.
    const editBefore = withIngredients(recipe(), [newIngredient('i-1', 'salt')]);
    const editAfter = withIngredients(recipe(), [newIngredient('i-1', 'sea salt')]);
    const editDiff = diffRecipe(editBefore, editAfter);
    expect(editDiff.ingredients.changed).toEqual([{ id: 'i-1', from: 'salt', to: 'sea salt' }]);
    expect(editDiff.ingredients.added).toEqual([]);
    expect(editDiff.ingredients.removed).toEqual([]);

    // New id, new text, and too dissimilar for the fuzzy pass (Jaccard 0) → a
    // genuinely new item (added), old one removed — never a false "changed".
    const newBefore = withIngredients(recipe(), [newIngredient('i-1', 'salt')]);
    const newAfter = withIngredients(recipe(), [newIngredient('i-2', 'pepper')]);
    const newDiff = diffRecipe(newBefore, newAfter);
    expect(newDiff.ingredients.added).toEqual([{ id: 'i-2', rawText: 'pepper' }]);
    expect(newDiff.ingredients.removed).toEqual([{ id: 'i-1', rawText: 'salt' }]);
    expect(newDiff.ingredients.changed).toEqual([]);
  });

  it('pairs a reworded ingredient AND step with fresh ids (AI-flow style) as single changes', () => {
    // The AI author flow mints a fresh crypto.randomUUID() for every step and for
    // reworded ingredients, so a genuine reword changes BOTH id and content and
    // matches on neither the id nor the exact-content pass. The fuzzy pass reunites
    // them so each reads as one `old → new` edit, not a separate add + remove.
    const before = withSteps(
      withIngredients(recipe(), [newIngredient('i-old', '120ml hot water')]),
      [newStep('s-old', 'Simmer the sauce for 10 minutes')],
    );
    const after = withSteps(withIngredients(recipe(), [newIngredient('i-new', '120ml water')]), [
      newStep('s-new', 'Simmer the sauce for 15 minutes'),
    ]);
    const diff = diffRecipe(before, after);

    expect(diff.ingredients.changed).toEqual([
      { id: 'i-new', from: '120ml hot water', to: '120ml water' },
    ]);
    expect(diff.ingredients.added).toEqual([]);
    expect(diff.ingredients.removed).toEqual([]);

    expect(diff.steps.changed).toEqual([
      {
        id: 's-new',
        position: 1,
        text: {
          from: 'Simmer the sauce for 10 minutes',
          to: 'Simmer the sauce for 15 minutes',
        },
      },
    ]);
    expect(diff.steps.added).toEqual([]);
    expect(diff.steps.removed).toEqual([]);
  });

  it('leaves a dissimilar fresh-id pair as add + remove (conservative threshold)', () => {
    // Fresh ids on both sides, but the content is too dissimilar to be "the same
    // item reworded": sharing a couple of words ("hot smoked", Jaccard 0.4) is not
    // enough. A false "changed" here would tell the reviewer paprika became salmon,
    // which is worse than an honest add + remove — so the pair is left unpaired.
    const before = withIngredients(recipe(), [newIngredient('i-old', 'hot smoked paprika')]);
    const after = withIngredients(recipe(), [newIngredient('i-new', 'hot smoked salmon fillet')]);
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.added).toEqual([{ id: 'i-new', rawText: 'hot smoked salmon fillet' }]);
    expect(diff.ingredients.removed).toEqual([{ id: 'i-old', rawText: 'hot smoked paprika' }]);
    expect(diff.ingredients.changed).toEqual([]);
  });

  it('treats a new id with unchanged content as no change (rawText fallback)', () => {
    // The item text is identical but its id changed — must not read as remove+add.
    const before = withIngredients(recipe(), [newIngredient('i-old', '1 onion')]);
    const after = withIngredients(recipe(), [newIngredient('i-new', '1 onion')]);
    const diff = diffRecipe(before, after);
    expect(diff.ingredients.added).toEqual([]);
    expect(diff.ingredients.removed).toEqual([]);
    expect(diff.ingredients.changed).toEqual([]);
    expect(diff.hasChanges).toBe(false);
  });

  it('detects a step reword with its 1-based position', () => {
    const before = withSteps(recipe(), [
      newStep('s-1', 'Preheat oven'),
      newStep('s-2', 'Roast for 20 minutes'),
      newStep('s-3', 'Serve'),
    ]);
    const after = withSteps(recipe(), [
      newStep('s-1', 'Preheat oven'),
      newStep('s-2', 'Roast until deeply golden'),
      newStep('s-3', 'Serve'),
    ]);
    const diff = diffRecipe(before, after);
    expect(diff.steps.changed).toEqual([
      {
        id: 's-2',
        position: 2,
        text: { from: 'Roast for 20 minutes', to: 'Roast until deeply golden' },
      },
    ]);
  });

  it('detects a step timer change (re-time) without a text change', () => {
    const stepBefore: Step = {
      id: 's-1',
      text: 'Rest',
      timer: { durationMinutes: 5, description: null },
      note: null,
    };
    const stepAfter: Step = {
      id: 's-1',
      text: 'Rest',
      timer: { durationMinutes: 10, description: null },
      note: null,
    };
    const diff = diffRecipe(withSteps(recipe(), [stepBefore]), withSteps(recipe(), [stepAfter]));
    expect(diff.steps.changed).toEqual([
      {
        id: 's-1',
        position: 1,
        timer: {
          from: { durationMinutes: 5, description: null },
          to: { durationMinutes: 10, description: null },
        },
      },
    ]);
    expect(diff.steps.changed[0].text).toBeUndefined();
  });

  it('detects an added step (e.g. a resting step) with its position', () => {
    const before = withSteps(recipe(), [newStep('s-1', 'Mix'), newStep('s-2', 'Bake')]);
    const after = withSteps(recipe(), [
      newStep('s-1', 'Mix'),
      {
        id: 's-3',
        text: 'Rest the dough',
        timer: { durationMinutes: 10, description: null },
        note: null,
      },
      newStep('s-2', 'Bake'),
    ]);
    const diff = diffRecipe(before, after);
    expect(diff.steps.added).toEqual([{ id: 's-3', position: 2, text: 'Rest the dough' }]);
    expect(diff.steps.removed).toEqual([]);
    expect(diff.steps.changed).toEqual([]);
  });

  it('detects a removed step with its position in the existing recipe', () => {
    const before = withSteps(recipe(), [
      newStep('s-1', 'Mix'),
      newStep('s-2', 'Rest'),
      newStep('s-3', 'Bake'),
    ]);
    const after = withSteps(recipe(), [newStep('s-1', 'Mix'), newStep('s-3', 'Bake')]);
    const diff = diffRecipe(before, after);
    expect(diff.steps.removed).toEqual([{ id: 's-2', position: 2, text: 'Rest' }]);
    expect(diff.steps.added).toEqual([]);
  });

  it('reports a step note change', () => {
    const before = withSteps(recipe(), [{ id: 's-1', text: 'Fry', timer: null, note: null }]);
    const after = withSteps(recipe(), [
      { id: 's-1', text: 'Fry', timer: null, note: 'Use high heat' },
    ]);
    const diff = diffRecipe(before, after);
    expect(diff.steps.changed).toEqual([
      { id: 's-1', position: 1, note: { from: null, to: 'Use high heat' } },
    ]);
  });

  it('ignores a pure step reorder with no content change', () => {
    const before = withSteps(recipe(), [newStep('s-1', 'A'), newStep('s-2', 'B')]);
    const after = withSteps(recipe(), [newStep('s-2', 'B'), newStep('s-1', 'A')]);
    const diff = diffRecipe(before, after);
    expect(diff.hasChanges).toBe(false);
    expect(diff.steps).toEqual({ added: [], removed: [], changed: [] });
  });

  it('detects a servings change', () => {
    const diff = diffRecipe(
      withMetadata(recipe(), { servings: 2 }),
      withMetadata(recipe(), { servings: 4 }),
    );
    expect(diff.metadata.servings).toEqual({ from: 2, to: 4 });
    expect(diff.hasChanges).toBe(true);
  });

  it('detects each time-field change independently', () => {
    const before = withMetadata(recipe(), {
      totalTimeMinutes: 40,
      prepTimeMinutes: 10,
      cookTimeMinutes: 30,
    });
    const after = withMetadata(recipe(), {
      totalTimeMinutes: 55,
      prepTimeMinutes: 10,
      cookTimeMinutes: 45,
    });
    const diff = diffRecipe(before, after);
    expect(diff.metadata.totalTimeMinutes).toEqual({ from: 40, to: 55 });
    expect(diff.metadata.cookTimeMinutes).toEqual({ from: 30, to: 45 });
    expect(diff.metadata.prepTimeMinutes).toBeUndefined();
  });

  it('detects a null → number metadata change', () => {
    const diff = diffRecipe(
      withMetadata(recipe(), { servings: null }),
      withMetadata(recipe(), { servings: 6 }),
    );
    expect(diff.metadata.servings).toEqual({ from: null, to: 6 });
  });

  it('detects tag additions and removals', () => {
    const before = withMetadata(recipe(), { tags: ['dinner', 'vegetarian'] });
    const after = withMetadata(recipe(), { tags: ['dinner', 'quick'] });
    const diff = diffRecipe(before, after);
    expect(diff.tags).toEqual({ added: ['quick'], removed: ['vegetarian'] });
    expect(diff.hasChanges).toBe(true);
  });

  it('reports no tag change when the tag set is identical regardless of order', () => {
    const before = withMetadata(recipe(), { tags: ['a', 'b'] });
    const after = withMetadata(recipe(), { tags: ['b', 'a'] });
    const diff = diffRecipe(before, after);
    expect(diff.tags).toEqual({ added: [], removed: [] });
    expect(diff.hasChanges).toBe(false);
  });

  it('produces a schema-valid RecipeDiff shape', () => {
    const before = withIngredients(recipe({ title: 'X' }), [newIngredient('i-1', 'a')]);
    const after = withIngredients(recipe({ title: 'Y' }), [newIngredient('i-1', 'b')]);
    const diff: RecipeDiff = diffRecipe(before, after);
    // structural sanity: always-present sections exist even when empty
    expect(diff.ingredients).toBeDefined();
    expect(diff.steps).toBeDefined();
    expect(diff.metadata).toBeDefined();
    expect(diff.tags).toBeDefined();
  });

  it('is pure — does not mutate either input recipe', () => {
    const before = withIngredients(recipe({ title: 'A' }), [newIngredient('i-1', 'x')]);
    const after = withIngredients(recipe({ title: 'B' }), [newIngredient('i-2', 'y')]);
    const beforeSnapshot = structuredClone(before);
    const afterSnapshot = structuredClone(after);
    diffRecipe(before, after);
    expect(before).toEqual(beforeSnapshot);
    expect(after).toEqual(afterSnapshot);
  });
});
