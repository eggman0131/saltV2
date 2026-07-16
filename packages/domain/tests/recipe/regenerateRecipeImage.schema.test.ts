import { describe, it, expect } from 'vitest';
import { RegenerateRecipeImageInputSchema } from '@salt/domain/schemas';

// Input contract for the regenerateRecipeImage callable (issue #148, Tier-2).
describe('RegenerateRecipeImageInputSchema', () => {
  it('accepts a recipeId with no brief', () => {
    expect(RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1' }).success).toBe(true);
  });

  it('accepts and trims an optional brief', () => {
    const parsed = RegenerateRecipeImageInputSchema.parse({
      recipeId: 'r1',
      brief: '  Served in a deep bowl on a sunlit table.  ',
    });
    expect(parsed.brief).toBe('Served in a deep bowl on a sunlit table.');
  });

  it('accepts a paragraph-length brief', () => {
    expect(
      RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1', brief: 'x'.repeat(2000) })
        .success,
    ).toBe(true);
  });

  it('rejects an empty recipeId', () => {
    expect(RegenerateRecipeImageInputSchema.safeParse({ recipeId: '' }).success).toBe(false);
  });

  it('rejects a brief longer than 2000 chars', () => {
    // The cap keeps unbounded user text out of the image prompt, where the
    // house-style anchors are appended after the brief.
    expect(
      RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1', brief: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  // `hint` is retired: nothing writes imageHint any more, but an in-flight client
  // bundle can still send one. Accepted-and-ignored keeps those callers off
  // invalid-argument rather than failing their regenerate mid-deploy.
  it('still accepts a hint from an older client without rejecting the call', () => {
    const parsed = RegenerateRecipeImageInputSchema.safeParse({
      recipeId: 'r1',
      hint: 'make it brighter',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a hint longer than 200 chars', () => {
    expect(
      RegenerateRecipeImageInputSchema.safeParse({ recipeId: 'r1', hint: 'x'.repeat(201) }).success,
    ).toBe(false);
  });
});
