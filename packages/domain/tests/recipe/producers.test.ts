import { describe, it, expect } from 'vitest';
import { findProducingRecipes, emptyRecipe } from '@salt/domain';
import type { Recipe } from '@salt/domain';

function recipeProducing(id: string, producesCanonId: string | null): Recipe {
  return { ...emptyRecipe(id, '2026-01-01T00:00:00.000Z'), producesCanonId };
}

describe('findProducingRecipes', () => {
  it('returns the recipe whose producesCanonId matches the canon id', () => {
    const mayo = recipeProducing('r-mayo', 'canon-mayo');
    const other = recipeProducing('r-other', 'canon-stock');
    const result = findProducingRecipes([mayo, other], 'canon-mayo');
    expect(result).toEqual([mayo]);
  });

  it('returns every candidate in list order when more than one recipe produces the item', () => {
    const a = recipeProducing('r-a', 'canon-mayo');
    const b = recipeProducing('r-b', 'canon-mayo');
    const c = recipeProducing('r-c', 'canon-other');
    expect(findProducingRecipes([a, c, b], 'canon-mayo')).toEqual([a, b]);
  });

  it('returns empty when no recipe produces the item', () => {
    const a = recipeProducing('r-a', 'canon-mayo');
    expect(findProducingRecipes([a], 'canon-missing')).toEqual([]);
  });

  it('ignores recipes with a null producesCanonId (never matches)', () => {
    const linked = recipeProducing('r-linked', 'canon-mayo');
    const unlinked = recipeProducing('r-unlinked', null);
    expect(findProducingRecipes([linked, unlinked], 'canon-mayo')).toEqual([linked]);
  });

  it('is pure — does not mutate the input list', () => {
    const list = [recipeProducing('r-a', 'canon-mayo')];
    findProducingRecipes(list, 'canon-mayo');
    expect(list).toHaveLength(1);
  });
});
