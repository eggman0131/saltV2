import { describe, it, expect } from 'vitest';
import { resolveIngredientProductForm } from '@salt/domain';
import type { CanonNaming, ProductForm } from '@salt/domain';
// Empty canon list: `resolveProductForm`'s contested-phrase rule (issue #1180)
// is inert without one, so these cases measure only what they mean to.
const NO_CANON: readonly CanonNaming[] = [];

function form(overrides: Partial<ProductForm> = {}): ProductForm {
  return {
    id: 'f-juice',
    schemaVersion: 1,
    matchers: [],
    parentCanonId: 'c-lime',
    label: 'lime juice',
    yield: { formUnit: 'ml', amountPerParent: 30 },
    updatedAt: '',
    thumbnail: null,
    ...overrides,
  };
}

const FORMS = [form(), form({ id: 'f-zest', label: 'lime zest' })];

describe('resolveIngredientProductForm', () => {
  it('finds the form an ingredient names', () => {
    expect(resolveIngredientProductForm('lime juice', 'c-lime', FORMS, NO_CANON)?.id).toBe(
      'f-juice',
    );
  });

  it('picks the longest matching phrase, as resolveProductForm does', () => {
    expect(resolveIngredientProductForm('fresh lime zest', 'c-lime', FORMS, NO_CANON)?.id).toBe(
      'f-zest',
    );
  });

  // The guard this function exists for.
  it('refuses a form whose parent is not the ingredient’s canon item', () => {
    expect(resolveIngredientProductForm('lime juice', 'c-lemon', FORMS, NO_CANON)).toBeNull();
  });

  it('returns null for an ingredient that never matched a canon item', () => {
    expect(resolveIngredientProductForm('lime juice', null, FORMS, NO_CANON)).toBeNull();
  });

  it('returns null when the ingredient never parsed', () => {
    expect(resolveIngredientProductForm(null, 'c-lime', FORMS, NO_CANON)).toBeNull();
    expect(resolveIngredientProductForm(undefined, 'c-lime', FORMS, NO_CANON)).toBeNull();
    expect(resolveIngredientProductForm('', 'c-lime', FORMS, NO_CANON)).toBeNull();
  });

  it('returns null when nothing names a form — the ordinary case', () => {
    expect(resolveIngredientProductForm('lime', 'c-lime', FORMS, NO_CANON)).toBeNull();
  });

  it('returns null against an empty form table', () => {
    expect(resolveIngredientProductForm('lime juice', 'c-lime', [], NO_CANON)).toBeNull();
  });
});
