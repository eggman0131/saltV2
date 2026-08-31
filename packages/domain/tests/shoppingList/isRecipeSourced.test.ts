import { describe, expect, it } from 'vitest';
import { isRecipeSourced } from '../../src/index.js';
import type { ShoppingListItem, SourceRef } from '../../src/index.js';

function item(sources: SourceRef[]): ShoppingListItem {
  return {
    id: 'i1',
    rawText: 'whole chicken',
    notes: '',
    sources,
    canonId: 'c1',
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}

describe('isRecipeSourced', () => {
  it('is true for a row a recipe put on the list', () => {
    expect(isRecipeSourced(item([{ kind: 'recipe', recipeId: 'r1', servings: 4 }]))).toBe(true);
  });

  it('is false for a row a person typed', () => {
    expect(isRecipeSourced(item([{ kind: 'manual', addedBy: 'Daniel' }]))).toBe(false);
  });

  // The display split turns on this: a manual row keeps the wording it was added
  // with, so a row with nothing to go on must not be read as a recipe's.
  it('is false for a row carrying no source at all', () => {
    expect(isRecipeSourced(item([]))).toBe(false);
  });
});
