import { describe, it, expect } from 'vitest';
import { RegenerateRecipeImageInputSchema } from '@salt/domain/schemas';

// Input contract for the regenerateRecipeImage callable (issue #148, Tier-2).
describe('RegenerateRecipeImageInputSchema', () => {
  it('accepts a recipeId with no hint', () => {
    expect(RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1' }).success).toBe(true);
  });

  it('accepts and trims an optional hint', () => {
    const parsed = RegenerateRecipeImageInputSchema.parse({
      recipeId: 'r1',
      hint: '  make it brighter  ',
    });
    expect(parsed.hint).toBe('make it brighter');
  });

  it('rejects an empty recipeId', () => {
    expect(RegenerateRecipeImageInputSchema.safeParse({ recipeId: '' }).success).toBe(false);
  });

  it('rejects a hint longer than 200 chars', () => {
    expect(
      RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1', hint: 'x'.repeat(201) }).success,
    ).toBe(false);
  });
});
