import { describe, it, expect } from 'vitest';
import { clearIngredientMatch, newIngredient } from '@salt/domain';
import type { Ingredient } from '@salt/domain';

function matchedIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    ...newIngredient('id-1', '2 cloves garlic'),
    parsed: {
      quantity: { type: 'single', value: 2 },
      unit: null,
      item: 'garlic',
      preparation: ['minced'],
      notes: null,
      convertedWeight: null,
    },
    canonId: 'canon-abc',
    matchState: 'matched',
    ...overrides,
  };
}

describe('clearIngredientMatch', () => {
  it('sets parsed to null', () => {
    expect(clearIngredientMatch(matchedIngredient()).parsed).toBeNull();
  });

  it('sets canonId to null', () => {
    expect(clearIngredientMatch(matchedIngredient()).canonId).toBeNull();
  });

  it('sets matchState to pending', () => {
    expect(clearIngredientMatch(matchedIngredient()).matchState).toBe('pending');
  });

  it('also clears a failed ingredient', () => {
    const ing = matchedIngredient({ matchState: 'failed', canonId: null });
    const result = clearIngredientMatch(ing);
    expect(result.matchState).toBe('pending');
    expect(result.canonId).toBeNull();
  });

  it('preserves rawText', () => {
    expect(clearIngredientMatch(matchedIngredient()).rawText).toBe('2 cloves garlic');
  });

  it('preserves id', () => {
    expect(clearIngredientMatch(matchedIngredient()).id).toBe('id-1');
  });

  it('preserves isOptional', () => {
    const ing = matchedIngredient({ isOptional: true });
    expect(clearIngredientMatch(ing).isOptional).toBe(true);
  });

  it('preserves firstUsedInStepId', () => {
    const ing = matchedIngredient({ firstUsedInStepId: 'step-99' });
    expect(clearIngredientMatch(ing).firstUsedInStepId).toBe('step-99');
  });
});
