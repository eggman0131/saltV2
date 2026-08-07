import { describe, it, expect } from 'vitest';
import { ExtractRecipeAIOutputSchema } from '../../src/schemas/index.js';

// The gate the URL and book-photo imports both feed their model output through.
// Issue #739: it used to reject `cookTimeMinutes: 0`, which is the CORRECT answer
// for anything assembled rather than cooked — so a Greek salad failed its import
// on the model getting it right.

const BASE = {
  isRecipe: true,
  title: 'Greek salad',
  description: 'Chunky, quick, no cooking at all.',
  servings: 4,
  totalTimeMinutes: 15,
  prepTimeMinutes: 15,
  cookTimeMinutes: 0,
  tags: ['greek'],
  ingredientGroups: [
    {
      name: null,
      ingredients: [{ rawText: '2 tomatoes', isOptional: false, firstUsedInStepOrdinal: 0 }],
    },
  ],
  steps: [{ text: 'Chop the tomatoes.', timerMinutes: null, timerLabel: null, note: null }],
  notes: null,
};

describe('ExtractRecipeAIOutputSchema — zero on the time fields', () => {
  it('accepts cookTimeMinutes: 0 — a no-cook recipe is a real recipe', () => {
    const parsed = ExtractRecipeAIOutputSchema.safeParse(BASE);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.cookTimeMinutes).toBe(0);
  });

  it('accepts prepTimeMinutes: 0 — nothing to prepare is a real answer too', () => {
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, prepTimeMinutes: 0 }).success).toBe(
      true,
    );
  });

  it('still accepts null on both — "not stated" keeps its own sentinel', () => {
    const parsed = ExtractRecipeAIOutputSchema.safeParse({
      ...BASE,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
    });

    expect(parsed.success).toBe(true);
  });
});

describe('ExtractRecipeAIOutputSchema — the glitch guards that stay strict', () => {
  it('rejects servings: 0 — a recipe nobody can eat is a model glitch', () => {
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, servings: 0 }).success).toBe(false);
  });

  it('rejects totalTimeMinutes: 0 — a recipe that takes no time at all is nonsense', () => {
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, totalTimeMinutes: 0 }).success).toBe(
      false,
    );
  });

  it('rejects a negative time on every field — widening to 0 did not widen past it', () => {
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, cookTimeMinutes: -1 }).success).toBe(
      false,
    );
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, prepTimeMinutes: -1 }).success).toBe(
      false,
    );
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, totalTimeMinutes: -1 }).success).toBe(
      false,
    );
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, servings: -1 }).success).toBe(false);
  });

  it('rejects a fractional time — these are whole minutes', () => {
    expect(ExtractRecipeAIOutputSchema.safeParse({ ...BASE, cookTimeMinutes: 2.5 }).success).toBe(
      false,
    );
  });
});
