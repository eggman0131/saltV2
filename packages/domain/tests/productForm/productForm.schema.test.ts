import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  createProductForm,
  updateProductForm,
  resolveProductForm,
  convertYield,
  setProductFormThumbnail,
  CANON_ICON_HIDDEN,
} from '@salt/domain';
import type { ProductForm, ProductFormIdGenerator } from '@salt/domain';
import { ProductFormSchema } from '@salt/domain/schemas';

function counterIds(): ProductFormIdGenerator {
  let n = 0;
  return { newProductFormId: () => `pf-${++n}` };
}

const baseDoc = {
  id: 'pf1',
  schemaVersion: 1 as const,
  matchers: ['lime juice'],
  parentCanonId: 'canon-lime',
  label: 'freshly squeezed lime juice',
  yield: { formUnit: 'ml' as const, amountPerParent: 30 },
  updatedAt: '',
};

describe('ProductForm schema', () => {
  it('schemaVersion is the literal 1', () => {
    expectTypeOf<ProductForm['schemaVersion']>().toEqualTypeOf<1>();
  });

  it('parses a valid product-form doc', () => {
    const result = ProductFormSchema.safeParse(baseDoc);
    expect(result.success).toBe(true);
  });

  it('rejects a doc with an unknown formUnit', () => {
    const result = ProductFormSchema.safeParse({
      ...baseDoc,
      yield: { formUnit: 'litres', amountPerParent: 1 },
    });
    expect(result.success).toBe(false);
  });
});

describe('createProductForm', () => {
  it('builds a form with schemaVersion 1 and empty updatedAt sentinel', () => {
    const result = createProductForm(
      {
        matchers: [' lime juice ', ''],
        parentCanonId: 'canon-lime',
        label: '  freshly squeezed lime juice ',
        formUnit: 'ml',
        amountPerParent: 30,
      },
      counterIds(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.updatedAt).toBe('');
    expect(result.value.matchers).toEqual(['lime juice']); // trimmed, blanks dropped
    expect(result.value.label).toBe('freshly squeezed lime juice');
  });

  it('rejects missing label / parent / matchers / non-positive yield', () => {
    const ids = counterIds();
    const base = {
      matchers: ['x'],
      parentCanonId: 'c',
      label: 'L',
      formUnit: 'g' as const,
      amountPerParent: 1,
    };
    expect(createProductForm({ ...base, label: '   ' }, ids).kind).toBe('err');
    expect(createProductForm({ ...base, parentCanonId: '' }, ids).kind).toBe('err');
    expect(createProductForm({ ...base, matchers: [' '] }, ids).kind).toBe('err');
    expect(createProductForm({ ...base, amountPerParent: 0 }, ids).kind).toBe('err');
  });
});

describe('updateProductForm', () => {
  it('applies a valid edit without mutating the input', () => {
    const original: ProductForm = { ...baseDoc };
    const result = updateProductForm(original, {
      matchers: ['lime juice', 'fresh lime juice'],
      parentCanonId: 'canon-lime',
      label: 'lime juice',
      formUnit: 'ml',
      amountPerParent: 25,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.yield.amountPerParent).toBe(25);
    expect(original.yield.amountPerParent).toBe(30); // unchanged
    expect(result.value.id).toBe('pf1'); // identity preserved
  });
});

describe('resolveProductForm', () => {
  // Fixture note (#818): `label` is matching input, competing with `matchers` on
  // equal terms — pf2 is reachable by its label alone, which no matcher spells.
  // The matching rules themselves are covered in resolveProductForm.test.ts.
  const forms: ProductForm[] = [
    { ...baseDoc, id: 'pf1', matchers: ['lime juice'] },
    { ...baseDoc, id: 'pf2', matchers: ['juice'], label: 'bottled juice' },
  ];

  it('matches on a normalised phrase', () => {
    expect(resolveProductForm('Fresh Lime Juice', forms)?.id).toBe('pf1');
  });

  it('longest phrase wins when several match', () => {
    // both "juice" (pf2) and "lime juice" (pf1) match "lime juice"; longest wins
    expect(resolveProductForm('lime juice', forms)?.id).toBe('pf1');
  });

  it('matches a form by its label', () => {
    expect(resolveProductForm('300 ml bottled juice', forms)?.id).toBe('pf2');
  });

  it('returns null when nothing matches', () => {
    expect(resolveProductForm('flour', forms)).toBeNull();
  });
});

describe('convertYield', () => {
  it('divides amount by amountPerParent', () => {
    expect(convertYield(90, { formUnit: 'ml', amountPerParent: 30 })).toBe(3);
  });

  it('guards a non-positive yield to 0', () => {
    expect(convertYield(90, { formUnit: 'ml', amountPerParent: 0 })).toBe(0);
  });
});

// Icon fields (issue #871). The one that matters for production is the FIRST:
// productForms is live data, and every form written before this shipped has no
// `thumbnail` key at all. If those failed validation the realtime subscription
// would silently skip them — every existing form would vanish from the catalog.
describe('ProductForm icon fields', () => {
  it('a doc written before icons existed parses, with thumbnail defaulted to null', () => {
    const result = ProductFormSchema.safeParse(baseDoc);
    expect(result.success).toBe(true);
    expect(result.success && result.data.thumbnail).toBeNull();
  });

  it('keeps a real icon URL', () => {
    const result = ProductFormSchema.safeParse({
      ...baseDoc,
      thumbnail: 'https://example.com/lime-juice.webp',
    });
    expect(result.success && result.data.thumbnail).toBe('https://example.com/lime-juice.webp');
  });

  it('keeps an explicit null and the hidden sentinel — all three states round-trip', () => {
    expect(ProductFormSchema.safeParse({ ...baseDoc, thumbnail: null }).success).toBe(true);
    const hidden = ProductFormSchema.safeParse({ ...baseDoc, thumbnail: CANON_ICON_HIDDEN });
    expect(hidden.success && hidden.data.thumbnail).toBe('hidden');
  });

  it('carries the optional hint and regenerate nonce when present', () => {
    const result = ProductFormSchema.safeParse({
      ...baseDoc,
      thumbnail: null,
      iconHint: 'show it as a bottle',
      iconRequestedAt: 1_700_000_000_000,
    });
    expect(result.success && result.data.iconHint).toBe('show it as a bottle');
    expect(result.success && result.data.iconRequestedAt).toBe(1_700_000_000_000);
  });

  it('createProductForm states thumbnail as null rather than omitting it', () => {
    const created = createProductForm(
      {
        matchers: ['lime juice'],
        parentCanonId: 'canon-lime',
        label: 'Lime juice',
        formUnit: 'ml',
        amountPerParent: 30,
      },
      counterIds(),
    );
    expect(created.kind).toBe('ok');
    // Firestore rejects `undefined` on a full-document write, so "absent" is not
    // an option here — the key must be present and null.
    expect(created.kind === 'ok' && 'thumbnail' in created.value).toBe(true);
    expect(created.kind === 'ok' && created.value.thumbnail).toBeNull();
  });

  it('setProductFormThumbnail sets the value and touches nothing else', () => {
    const form: ProductForm = { ...baseDoc, thumbnail: null };
    const hidden = setProductFormThumbnail(form, CANON_ICON_HIDDEN);
    expect(hidden.kind === 'ok' && hidden.value.thumbnail).toBe('hidden');
    expect(hidden.kind === 'ok' && hidden.value.label).toBe(form.label);
    expect(hidden.kind === 'ok' && hidden.value.matchers).toEqual(form.matchers);
    // Pure: the input is not mutated.
    expect(form.thumbnail).toBeNull();
  });

  it('updateProductForm preserves an already-generated icon', () => {
    const form: ProductForm = { ...baseDoc, thumbnail: 'https://example.com/lime-juice.webp' };
    const updated = updateProductForm(form, {
      matchers: ['lime juice', 'fresh lime juice'],
      parentCanonId: 'canon-lime',
      label: 'Lime juice',
      formUnit: 'ml',
      amountPerParent: 30,
    });
    expect(updated.kind === 'ok' && updated.value.thumbnail).toBe(
      'https://example.com/lime-juice.webp',
    );
  });
});
