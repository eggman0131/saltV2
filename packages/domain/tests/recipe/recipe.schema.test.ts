import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  emptyRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
  flattenIngredients,
} from '@salt/domain';
import type { Recipe, Ingredient } from '@salt/domain';
import { RecipeSchema, QuantitySchema } from '@salt/domain/schemas';

// A deliberately messy recipe that exercises the union types: two groups (one
// named, one default/unnamed), a single quantity, a range, a mixed "1 ½", a bare
// "½", an optional ingredient, an unparsed line, and a step with a timer.
function messyRecipe(): Recipe {
  const sauce: Ingredient[] = [
    {
      ...newIngredient('ing-1', '2 cloves garlic, minced'),
      parsed: {
        quantity: { type: 'single', value: 2 },
        unit: null,
        item: 'garlic',
        preparation: ['minced'],
        notes: null,
      },
    },
    {
      ...newIngredient('ing-2', '2–3 tbsp olive oil'),
      parsed: {
        quantity: { type: 'range', min: 2, max: 3 },
        unit: 'tbsp',
        item: 'olive oil',
        preparation: [],
        notes: null,
      },
    },
  ];

  const base: Ingredient[] = [
    {
      ...newIngredient('ing-3', '1 ½ cups flour'),
      parsed: {
        quantity: { type: 'mixed', whole: 1, numerator: 1, denominator: 2 },
        unit: 'cups',
        item: 'flour',
        preparation: [],
        notes: null,
      },
    },
    {
      ...newIngredient('ing-4', '½ tsp salt'),
      parsed: {
        quantity: { type: 'mixed', whole: 0, numerator: 1, denominator: 2 },
        unit: 'tsp',
        item: 'salt',
        preparation: [],
        notes: 'or to taste',
      },
    },
    // An optional, still-unparsed garnish.
    newIngredient('ing-5', 'fresh basil, to garnish', true),
  ];

  return {
    ...emptyRecipe('recipe-1', '2026-06-11T10:00:00.000Z'),
    title: 'Messy Test Pasta',
    description: 'A fixture, not a meal.',
    notes: 'Double the sauce.',
    ingredients: [
      { ...emptyIngredientGroup('grp-1', 'For the sauce'), items: sauce },
      { ...emptyIngredientGroup('grp-2'), items: base },
    ],
    steps: [
      newStep('step-1', 'Mix the dry ingredients.'),
      {
        ...newStep('step-2', 'Simmer the sauce.'),
        timer: { durationMinutes: 20, description: 'low heat' },
      },
    ],
    metadata: {
      servings: 4,
      totalTimeMinutes: 45,
      prepTimeMinutes: 15,
      cookTimeMinutes: 30,
      tags: ['pasta', 'dinner'],
    },
    source: { type: 'manual' },
    updatedAt: '2026-06-11T10:05:00.000Z',
  };
}

describe('RecipeSchema', () => {
  it('round-trips a messy recipe unchanged (groups, range, mixed, optional, unparsed)', () => {
    const recipe = messyRecipe();
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(recipe);
  });

  it('preserves an exact "1 ½" rather than collapsing to 1.5', () => {
    const recipe = messyRecipe();
    const flour = flattenIngredients(recipe).find((i) => i.id === 'ing-3');
    expect(flour?.parsed?.quantity).toEqual({
      type: 'mixed',
      whole: 1,
      numerator: 1,
      denominator: 2,
    });
  });

  it('keeps rawText for an unparsed optional ingredient', () => {
    const garnish = flattenIngredients(messyRecipe()).find((i) => i.id === 'ing-5');
    expect(garnish?.rawText).toBe('fresh basil, to garnish');
    expect(garnish?.parsed).toBeNull();
    expect(garnish?.isOptional).toBe(true);
    expect(garnish?.matchState).toBe('pending');
  });

  it('accepts a blank recipe from emptyRecipe', () => {
    expect(RecipeSchema.safeParse(emptyRecipe('r', '2026-06-11T00:00:00.000Z')).success).toBe(true);
  });

  it('rejects an unknown matchState', () => {
    const recipe = messyRecipe();
    const broken = {
      ...recipe,
      ingredients: [
        {
          ...recipe.ingredients[0]!,
          items: [{ ...recipe.ingredients[0]!.items[0]!, matchState: 'unmatched' }],
        },
      ],
    };
    expect(RecipeSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects schemaVersion other than 1', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects a zero denominator on a mixed quantity', () => {
    expect(
      QuantitySchema.safeParse({ type: 'mixed', whole: 1, numerator: 1, denominator: 0 }).success,
    ).toBe(false);
  });

  it('rejects an unknown quantity discriminant', () => {
    expect(QuantitySchema.safeParse({ type: 'decimal', value: 1.5 }).success).toBe(false);
  });

  it('type-level: schemaVersion is the literal 1', () => {
    expectTypeOf<Recipe['schemaVersion']>().toEqualTypeOf<1>();
  });
});
