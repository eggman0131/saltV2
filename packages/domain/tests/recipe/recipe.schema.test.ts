import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  emptyRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
  flattenIngredients,
} from '@salt/domain';
import type { Recipe, Ingredient, RecipeImage } from '@salt/domain';
import { RecipeSchema, QuantitySchema, RecipeImageSchema } from '@salt/domain/schemas';

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
        displayText: null,
      },
      // firstUsedInStepId seam: links to step-1
      firstUsedInStepId: 'step-1',
    },
    {
      ...newIngredient('ing-2', '2–3 tbsp olive oil'),
      parsed: {
        quantity: { type: 'range', min: 30, max: 45 },
        unit: 'ml',
        item: 'olive oil',
        preparation: [],
        notes: null,
        displayText: '2–3 tbsp',
      },
    },
  ];

  const base: Ingredient[] = [
    {
      ...newIngredient('ing-3', '1 ½ cups flour'),
      parsed: {
        quantity: { type: 'single', value: 180 },
        unit: 'g',
        item: 'flour',
        preparation: [],
        notes: null,
        displayText: '1½ cups',
      },
    },
    {
      ...newIngredient('ing-4', '½ tsp salt'),
      parsed: {
        quantity: { type: 'single', value: 2.5 },
        unit: 'ml',
        item: 'salt',
        preparation: [],
        notes: 'or to taste',
        displayText: '½ tsp',
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
    image: { url: 'https://storage.example/recipe-1.jpg', source: 'ai' },
    ingredients: [
      { ...emptyIngredientGroup('grp-1', 'For the sauce'), items: sauce },
      { ...emptyIngredientGroup('grp-2'), items: base },
    ],
    steps: [
      { ...newStep('step-1', 'Mix the dry ingredients.'), note: 'Sift the flour first.' },
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

  it('stores displayText for non-metric source measures', () => {
    const recipe = messyRecipe();
    const flour = flattenIngredients(recipe).find((i) => i.id === 'ing-3');
    expect(flour?.parsed?.displayText).toBe('1½ cups');
    expect(flour?.parsed?.unit).toBe('g');
    expect(flour?.parsed?.quantity).toEqual({ type: 'single', value: 180 });
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

  // --- Phase 1 (issue #180): new fields ---

  it('round-trips a step note', () => {
    const recipe = messyRecipe();
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0]!.note).toBe('Sift the flour first.');
      expect(result.data.steps[1]!.note).toBeNull();
    }
  });

  it('round-trips ingredient firstUsedInStepId', () => {
    const recipe = messyRecipe();
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) {
      const garlic = flattenIngredients(result.data).find((i) => i.id === 'ing-1');
      expect(garlic?.firstUsedInStepId).toBe('step-1');
      const oil = flattenIngredients(result.data).find((i) => i.id === 'ing-2');
      expect(oil?.firstUsedInStepId).toBeNull();
    }
  });

  it('round-trips recipe image with source "ai"', () => {
    const recipe = messyRecipe();
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image).toEqual({
        url: 'https://storage.example/recipe-1.jpg',
        source: 'ai',
      });
    }
  });

  it('round-trips recipe image with source "upload"', () => {
    const recipe: Recipe = {
      ...messyRecipe(),
      image: { url: 'https://storage.example/upload.jpg', source: 'upload' },
    };
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.image?.source).toBe('upload');
  });

  it('rejects an unknown image source', () => {
    const recipe = { ...messyRecipe(), image: { url: 'https://x.com/img.jpg', source: 'camera' } };
    expect(RecipeSchema.safeParse(recipe).success).toBe(false);
  });

  it('RecipeImageSchema validates ai and upload sources', () => {
    expect(RecipeImageSchema.safeParse({ url: 'https://x.com/a.jpg', source: 'ai' }).success).toBe(
      true,
    );
    expect(
      RecipeImageSchema.safeParse({ url: 'https://x.com/b.jpg', source: 'upload' }).success,
    ).toBe(true);
    expect(
      RecipeImageSchema.safeParse({ url: 'https://x.com/c.jpg', source: 'other' }).success,
    ).toBe(false);
  });

  it('builders default new fields to null', () => {
    const step = newStep('s1', 'text');
    expect(step.note).toBeNull();

    const ingredient = newIngredient('i1', 'raw');
    expect(ingredient.firstUsedInStepId).toBeNull();

    const recipe = emptyRecipe('r1', '2026-06-11T00:00:00.000Z');
    expect(recipe.image).toBeNull();
  });

  it('type-level: RecipeImage source is "ai" | "upload"', () => {
    expectTypeOf<RecipeImage['source']>().toEqualTypeOf<'ai' | 'upload'>();
  });

  // --- Tier-2 hero-image control fields (issue #148) ---

  it('round-trips the imageHint / imageRequestedAt / imageHidden control fields', () => {
    const recipe: Recipe = {
      ...messyRecipe(),
      image: null,
      imageHint: 'brighter, on a wooden board',
      imageRequestedAt: 1_700_000_000_000,
      imageHidden: true,
    };
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageHint).toBe('brighter, on a wooden board');
      expect(result.data.imageRequestedAt).toBe(1_700_000_000_000);
      expect(result.data.imageHidden).toBe(true);
    }
  });

  // Back-compat: a recipe written before Tier-2 has none of the control fields;
  // it MUST still parse, and the optional fields stay absent (no defaults added).
  it('parses a recipe with no hero-image control fields (back-compat)', () => {
    const recipe = messyRecipe();
    expect('imageHint' in recipe).toBe(false);
    const result = RecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageHint).toBeUndefined();
      expect(result.data.imageRequestedAt).toBeUndefined();
      expect(result.data.imageHidden).toBeUndefined();
    }
  });

  it('rejects a non-numeric imageRequestedAt and a non-boolean imageHidden', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), imageRequestedAt: 'soon' }).success).toBe(
      false,
    );
    expect(RecipeSchema.safeParse({ ...messyRecipe(), imageHidden: 'yes' }).success).toBe(false);
  });
});
