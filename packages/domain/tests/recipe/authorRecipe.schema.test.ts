import { describe, it, expect } from 'vitest';
import {
  LibrarianOutputSchema,
  ExtractRecipeAIOutputSchema,
  MAX_RECIPE_PHASES,
} from '../../src/schemas/index.js';

// The gate the librarian (chat authoring — create, edit and variation) feeds its
// model output through. It had no test file at all until issue #1123, which is
// how `servings` stayed unconstrained here for as long as it did: #952 aligned
// the three time fields with the extractor's and left the fourth field behind,
// and nothing went red.

const BASE = {
  title: 'Carbonara',
  description: 'Guanciale, egg, pecorino.',
  servings: 4,
  tags: ['italian'],
  ingredientGroups: [
    {
      name: null,
      ingredients: [{ rawText: '2 eggs', isOptional: false, firstUsedInStepOrdinal: 0 }],
    },
  ],
  steps: [{ text: 'Beat the eggs.', timerMinutes: null, timerLabel: null, note: null }],
  notes: null,
};

describe('LibrarianOutputSchema — servings', () => {
  it('accepts a positive whole count, and null for "not stated"', () => {
    expect(LibrarianOutputSchema.safeParse(BASE).success).toBe(true);
    expect(LibrarianOutputSchema.safeParse({ ...BASE, servings: null }).success).toBe(true);
  });

  it('rejects servings: 0 — a recipe nobody can eat is a model glitch', () => {
    expect(LibrarianOutputSchema.safeParse({ ...BASE, servings: 0 }).success).toBe(false);
  });

  it('rejects a negative count', () => {
    expect(LibrarianOutputSchema.safeParse({ ...BASE, servings: -3 }).success).toBe(false);
  });

  it('rejects a fractional count — these are whole servings', () => {
    expect(LibrarianOutputSchema.safeParse({ ...BASE, servings: 2.5 }).success).toBe(false);
  });
});

// The header comment on `LibrarianOutputSchema` claims its numeric field carries
// the same constraints as `ExtractRecipeAIOutputSchema`'s. That sentence is
// exactly the kind nothing falsifies when one of the two files is edited alone —
// which is what happened between #952 and #1123 — so it is pinned rather than
// asserted: one value matrix, both schemas, identical verdicts required.
describe('LibrarianOutputSchema agrees with ExtractRecipeAIOutputSchema, number for number', () => {
  const NUMERIC_FIELDS = ['servings'] as const;
  const VALUES = [0, 1, -1, 2.5, 1440, null];

  // The extractor carries one field the librarian does not: `isRecipe` marks a
  // page that turned out not to be a recipe at all, which a conversation cannot
  // be. Everything else the two share.
  const EXTRACTOR_BASE = { ...BASE, isRecipe: true };

  for (const field of NUMERIC_FIELDS) {
    for (const value of VALUES) {
      it(`${field}: ${String(value)}`, () => {
        const librarian = LibrarianOutputSchema.safeParse({ ...BASE, [field]: value }).success;
        const extractor = ExtractRecipeAIOutputSchema.safeParse({
          ...EXTRACTOR_BASE,
          [field]: value,
        }).success;

        expect(librarian).toBe(extractor);
      });
    }
  }
});

// The `phases` gate has no retry on this path (issue #1122 review, blocking 3):
// `authorRecipe.ts` throws straight from a failed `LibrarianOutputSchema` parse,
// so a strip that fails `AuthoredRecipePhasesSchema` must degrade to no strip
// rather than take the whole chat-authored recipe down with it.
describe('LibrarianOutputSchema — a malformed strip degrades, never fails the parse', () => {
  const validPhase = { label: 'Prep', handsOnMinutes: 10, handsOffMinutes: 0 };

  it('accepts a strip at the cap', () => {
    const phases = Array.from({ length: MAX_RECIPE_PHASES }, () => validPhase);
    const result = LibrarianOutputSchema.safeParse({ ...BASE, phases });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phases).toHaveLength(MAX_RECIPE_PHASES);
  });

  it('drops a strip one block over the cap, and keeps the rest of the recipe', () => {
    const phases = Array.from({ length: MAX_RECIPE_PHASES + 1 }, () => validPhase);
    const result = LibrarianOutputSchema.safeParse({ ...BASE, phases });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phases).toEqual([]);
      expect(result.data.title).toBe('Carbonara');
    }
  });

  it('drops a strip with a fractional minute, and keeps the rest of the recipe', () => {
    const phases = [{ label: 'Prep', handsOnMinutes: 7.5, handsOffMinutes: 0 }];
    const result = LibrarianOutputSchema.safeParse({ ...BASE, phases });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phases).toEqual([]);
      expect(result.data.title).toBe('Carbonara');
    }
  });

  it('drops a strip with a negative minute', () => {
    const phases = [{ label: 'Prep', handsOnMinutes: -1, handsOffMinutes: 0 }];
    const result = LibrarianOutputSchema.safeParse({ ...BASE, phases });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phases).toEqual([]);
  });
});
