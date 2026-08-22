import { describe, it, expect } from 'vitest';
import { resolveIngredientProductForm } from '@salt/domain';
import type { ProductForm } from '@salt/domain';

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
    expect(resolveIngredientProductForm('lime juice', 'c-lime', FORMS)?.id).toBe('f-juice');
  });

  it('picks the longest matching phrase, as resolveProductForm does', () => {
    expect(resolveIngredientProductForm('fresh lime zest', 'c-lime', FORMS)?.id).toBe('f-zest');
  });

  // The guard this function exists for.
  it('refuses a form whose parent is not the ingredient’s canon item', () => {
    expect(resolveIngredientProductForm('lime juice', 'c-lemon', FORMS)).toBeNull();
  });

  it('returns null for an ingredient that never matched a canon item', () => {
    expect(resolveIngredientProductForm('lime juice', null, FORMS)).toBeNull();
  });

  it('returns null when the ingredient never parsed', () => {
    expect(resolveIngredientProductForm(null, 'c-lime', FORMS)).toBeNull();
    expect(resolveIngredientProductForm(undefined, 'c-lime', FORMS)).toBeNull();
    expect(resolveIngredientProductForm('', 'c-lime', FORMS)).toBeNull();
  });

  it('returns null when nothing names a form — the ordinary case', () => {
    expect(resolveIngredientProductForm('lime', 'c-lime', FORMS)).toBeNull();
  });

  it('returns null against an empty form table', () => {
    expect(resolveIngredientProductForm('lime juice', 'c-lime', [])).toBeNull();
  });
});
