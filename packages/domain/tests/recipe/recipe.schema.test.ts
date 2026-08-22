import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  emptyRecipe,
  emptyIngredientGroup,
  newIngredient,
  newStep,
  flattenIngredients,
} from '@salt/domain';
import type { Recipe, Ingredient, RecipeImage } from '@salt/domain';
import {
  RecipeSchema,
  QuantitySchema,
  RecipeImageSchema,
  RecipeKindSchema,
} from '@salt/domain/schemas';

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

  // Review state for AI imports (issue #616). Back-compat is the whole point of
  // it being optional: every recipe already in the production collection lacks
  // the field and must keep parsing, reading as reviewed (absent).
  it('parses a recipe with needs_approval set, and one without it (back-compat)', () => {
    const unreviewed = RecipeSchema.safeParse({ ...messyRecipe(), needs_approval: true });
    expect(unreviewed.success).toBe(true);
    if (unreviewed.success) expect(unreviewed.data.needs_approval).toBe(true);

    const existing = messyRecipe();
    expect('needs_approval' in existing).toBe(false);
    const result = RecipeSchema.safeParse(existing);
    expect(result.success).toBe(true);
    // Absent, NOT defaulted to false — absent means reviewed.
    if (result.success) expect(result.data.needs_approval).toBeUndefined();
  });

  it('rejects a non-boolean needs_approval', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), needs_approval: 'yes' }).success).toBe(false);
  });

  // The kind discriminator (issue #637). `.default('recipe')` is the back-compat
  // guarantee for the production collection (#240): the realtime subscription
  // SKIPS documents that fail validation, so a required `kind` would empty the
  // recipe list for every existing user.
  it('defaults a recipe written before `kind` existed to "recipe"', () => {
    const { kind: _omitted, ...legacy } = messyRecipe();
    expect('kind' in legacy).toBe(false);
    const result = RecipeSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('recipe');
  });

  it('round-trips each of the three kinds', () => {
    for (const kind of ['recipe', 'outing', 'cocktail'] as const) {
      const result = RecipeSchema.safeParse({ ...messyRecipe(), kind });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.kind).toBe(kind);
    }
  });

  it('rejects an unknown kind', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), kind: 'pudding' }).success).toBe(false);
    expect(RecipeKindSchema.safeParse('pudding').success).toBe(false);
    expect(RecipeKindSchema.safeParse('outing').success).toBe(true);
  });

  it('emptyRecipe builds a recipe by default and the asked-for kind otherwise', () => {
    expect(emptyRecipe('r1', '2026-06-11T00:00:00.000Z').kind).toBe('recipe');
    expect(emptyRecipe('r2', '2026-06-11T00:00:00.000Z', 'outing').kind).toBe('outing');
  });

  it('type-level: Recipe kind is the closed union', () => {
    expectTypeOf<Recipe['kind']>().toEqualTypeOf<'recipe' | 'outing' | 'cocktail'>();
  });

  // --- Attribution (issue #845) ---

  // The property the whole `.default('')` choice exists for: every recipe already
  // in production predates these fields, and the realtime subscription SKIPS
  // documents that fail validation — a required field would have emptied the
  // library.
  it('parses a document carrying neither attribution field, defaulting both to blank', () => {
    const { createdBy: _c, lastEditedBy: _e, ...legacy } = messyRecipe();
    expect('createdBy' in legacy).toBe(false);
    expect('lastEditedBy' in legacy).toBe(false);
    const result = RecipeSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdBy).toBe('');
      expect(result.data.lastEditedBy).toBe('');
    }
  });

  it('round-trips the two names it was given', () => {
    const result = RecipeSchema.safeParse({
      ...messyRecipe(),
      createdBy: 'Daniel',
      lastEditedBy: 'Kate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdBy).toBe('Daniel');
      expect(result.data.lastEditedBy).toBe('Kate');
    }
  });

  it('emptyRecipe leaves both blank — the domain knows no user', () => {
    const blank = emptyRecipe('r1', '2026-06-11T00:00:00.000Z');
    expect(blank.createdBy).toBe('');
    expect(blank.lastEditedBy).toBe('');
  });

  it('rejects a non-numeric imageRequestedAt and a non-boolean imageHidden', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), imageRequestedAt: 'soon' }).success).toBe(
      false,
    );
    expect(RecipeSchema.safeParse({ ...messyRecipe(), imageHidden: 'yes' }).success).toBe(false);
  });

  // --- Kit (issue #882) ---

  it('defaults kit to [] on a document written before the field existed', () => {
    // The back-compat case that matters: every recipe already in production (#240)
    // predates `kit`, and the realtime subscription SKIPS documents that fail
    // validation — so a required field here would have emptied the recipe list.
    const { kit: _kit, ...pre882 } = messyRecipe();
    const result = RecipeSchema.safeParse(pre882);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kit).toEqual([]);
      // Absent, not `undefined`-valued: absence is what "never inferred" means, and
      // the trigger's guard reads exactly that.
      expect(result.data.kitInferredAt).toBeUndefined();
      expect(result.data.kitRequestedAt).toBeUndefined();
    }
  });

  it('round-trips a kit entry with several steps', () => {
    const result = RecipeSchema.safeParse({
      ...messyRecipe(),
      kit: [{ label: 'large frying pan', stepIds: ['step-1', 'step-2'] }],
      kitInferredAt: 1_700_000_000_000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kit).toEqual([
        { label: 'large frying pan', stepIds: ['step-1', 'step-2'] },
      ]);
      expect(result.data.kitInferredAt).toBe(1_700_000_000_000);
    }
  });

  it('accepts any label — the vocabulary is never an enum on the schema', () => {
    const result = RecipeSchema.safeParse({
      ...messyRecipe(),
      kit: [{ label: 'tagine', stepIds: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-numeric kitInferredAt and a malformed kit entry', () => {
    expect(RecipeSchema.safeParse({ ...messyRecipe(), kitInferredAt: 'later' }).success).toBe(
      false,
    );
    expect(RecipeSchema.safeParse({ ...messyRecipe(), kit: [{ label: 'pan' }] }).success).toBe(
      false,
    );
  });
});
