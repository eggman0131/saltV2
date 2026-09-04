import { describe, it, expect } from 'vitest';
import {
  ExtractRecipeFromPhotoInputSchema,
  ExtractRecipeFromPhotoAIOutputSchema,
  ExtractRecipeAIOutputSchema,
  ExtractRecipeFromPhotoWireInputSchema,
  MAX_RECIPE_PAGE_PHOTOS,
  PHOTO_IMPORT_FAILURE_CODES,
  PHOTO_IMPORT_TIMEOUT_SECONDS,
} from '../../src/schemas/index.js';
import { RecipeSourceSchema } from '../../src/schemas/recipe.js';

// Import a recipe from photographs of a cookbook page (issue #649, Phase 3).

const PHOTO = { base64: 'AAAA', contentType: 'image/webp' as const };

const pages = (n: number) => ({ images: Array.from({ length: n }, () => PHOTO) });

describe('ExtractRecipeFromPhotoInputSchema — payload bounds', () => {
  it('accepts 1 page (a recipe that fits on one)', () => {
    expect(ExtractRecipeFromPhotoInputSchema.safeParse(pages(1)).success).toBe(true);
  });

  it('accepts a full spread and up to the cap', () => {
    expect(ExtractRecipeFromPhotoInputSchema.safeParse(pages(2)).success).toBe(true);
    expect(ExtractRecipeFromPhotoInputSchema.safeParse(pages(MAX_RECIPE_PAGE_PHOTOS)).success).toBe(
      true,
    );
  });

  it('rejects zero pages — there is nothing to read', () => {
    expect(ExtractRecipeFromPhotoInputSchema.safeParse({ images: [] }).success).toBe(false);
  });

  it('rejects more than the cap — the payload has to stay inside the callable limit', () => {
    expect(
      ExtractRecipeFromPhotoInputSchema.safeParse(pages(MAX_RECIPE_PAGE_PHOTOS + 1)).success,
    ).toBe(false);
  });

  it('restricts contentType to the allowlist, not any string', () => {
    for (const contentType of ['image/webp', 'image/jpeg', 'image/png']) {
      expect(
        ExtractRecipeFromPhotoInputSchema.safeParse({ images: [{ base64: 'AAAA', contentType }] })
          .success,
      ).toBe(true);
    }
    // The content type becomes part of the data URI handed to the model, so it
    // is a closed set — a PDF or an SVG is not a page photograph.
    for (const contentType of ['application/pdf', 'image/svg+xml', 'text/plain', 'image/heic']) {
      expect(
        ExtractRecipeFromPhotoInputSchema.safeParse({ images: [{ base64: 'AAAA', contentType }] })
          .success,
      ).toBe(false);
    }
  });

  it('rejects empty bytes', () => {
    expect(
      ExtractRecipeFromPhotoInputSchema.safeParse({
        images: [{ base64: '', contentType: 'image/webp' }],
      }).success,
    ).toBe(false);
  });
});

describe('ExtractRecipeFromPhotoWireInputSchema — trace envelope', () => {
  it('carries an optional traceparent on top of the domain input', () => {
    const parsed = ExtractRecipeFromPhotoWireInputSchema.safeParse({
      ...pages(1),
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });
    expect(parsed.success).toBe(true);
  });

  it('parses without a traceparent — the field is optional and additive', () => {
    expect(ExtractRecipeFromPhotoWireInputSchema.safeParse(pages(1)).success).toBe(true);
  });

  it('still rejects a malformed DOMAIN input — only the trace field is best-effort', () => {
    expect(
      ExtractRecipeFromPhotoWireInputSchema.safeParse({ images: [], traceparent: 'x' }).success,
    ).toBe(false);
  });
});

describe('ExtractRecipeFromPhotoAIOutputSchema — extends, never forks', () => {
  const BASE = {
    isRecipe: true,
    title: 'Ragù',
    description: null,
    servings: 4,
    tags: ['italian'],
    ingredientGroups: [
      {
        name: null,
        ingredients: [{ rawText: '500g beef mince', isOptional: false, firstUsedInStepOrdinal: 0 }],
      },
    ],
    steps: [{ text: 'Brown the mince.', timerMinutes: null, timerLabel: null, note: null }],
    notes: null,
  };

  it('keeps every field of the URL-import output schema (so conversion cannot drift)', () => {
    // The recipe half of the contract is literally the same schema, so metric +
    // British conversion is guaranteed identical across the two import paths.
    expect(ExtractRecipeAIOutputSchema.safeParse(BASE).success).toBe(true);
    expect(ExtractRecipeFromPhotoAIOutputSchema.safeParse({ ...BASE, book: null }).success).toBe(
      true,
    );
  });

  it('adds book provenance with each part independently nullable', () => {
    const parsed = ExtractRecipeFromPhotoAIOutputSchema.safeParse({
      ...BASE,
      book: { title: 'The Silver Spoon', author: null, page: 212 },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.book).toEqual({
      title: 'The Silver Spoon',
      author: null,
      page: 212,
    });
  });

  it('allows book: null when nothing about the book is legible', () => {
    const parsed = ExtractRecipeFromPhotoAIOutputSchema.safeParse({ ...BASE, book: null });
    expect(parsed.success && parsed.data.book).toBeNull();
  });

  it('leaves ExtractRecipeAIOutputSchema itself untouched (no book field added to it)', () => {
    const parsed = ExtractRecipeAIOutputSchema.safeParse({ ...BASE, book: { title: 'x' } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'book' in parsed.data).toBe(false);
  });
});

describe('RecipeSourceSchema — relaxed book provenance', () => {
  it('accepts a book source with only the parts the page actually showed', () => {
    expect(
      RecipeSourceSchema.safeParse({ type: 'book', book: { title: 'Persiana' } }).success,
    ).toBe(true);
    expect(RecipeSourceSchema.safeParse({ type: 'book', book: { page: 88 } }).success).toBe(true);
    expect(RecipeSourceSchema.safeParse({ type: 'book', book: {} }).success).toBe(true);
  });

  it('accepts a book source with no book at all — nothing was legible', () => {
    expect(RecipeSourceSchema.safeParse({ type: 'book' }).success).toBe(true);
  });

  it('still accepts a fully-populated book source (the relaxation is a widening)', () => {
    // Back-compat: every document that parsed before still parses.
    expect(
      RecipeSourceSchema.safeParse({
        type: 'book',
        book: { title: 'Persiana', author: 'Sabrina Ghayour', page: 88 },
      }).success,
    ).toBe(true);
  });

  it('still rejects wrongly-typed parts', () => {
    expect(RecipeSourceSchema.safeParse({ type: 'book', book: { page: 'iv' } }).success).toBe(
      false,
    );
  });
});

describe('photo-import constants', () => {
  it('has its OWN closed failure set — UrlImportFailureCode is not widened', () => {
    expect(PHOTO_IMPORT_FAILURE_CODES).toEqual([
      'invalid-photos',
      'unreadable-photos',
      'import-failed',
    ]);
  });

  it('gives the client a timeout budget well past the callable SDK default of 70s', () => {
    // The wrapper passes this as an explicit HttpsCallableOptions.timeout; if it
    // ever dropped below 70 the explicit option would be pointless.
    expect(PHOTO_IMPORT_TIMEOUT_SECONDS).toBeGreaterThan(70);
  });
});
