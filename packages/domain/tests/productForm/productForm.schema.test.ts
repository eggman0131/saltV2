import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  createProductForm,
  updateProductForm,
  resolveProductForm,
  convertYield,
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
  const forms: ProductForm[] = [
    { ...baseDoc, id: 'pf1', matchers: ['lime juice'] },
    { ...baseDoc, id: 'pf2', matchers: ['juice'], label: 'generic juice' },
  ];

  it('matches on a normalised substring', () => {
    expect(resolveProductForm('Fresh Lime Juice', forms)?.id).toBe('pf1');
  });

  it('longest matcher wins when several match', () => {
    // both "juice" and "lime juice" match "lime juice"; longest wins
    expect(resolveProductForm('lime juice', forms)?.id).toBe('pf1');
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
