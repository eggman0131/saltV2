import { describe, it, expect } from 'vitest';
import { ShoppingListItemSchema } from '@salt/domain/schemas';

// Distributed-trace correlation field (issue #362, Phase 5). The browser stamps a
// W3C `traceparent` onto the item doc as `traceContext` so the
// onShoppingListItemWrite trigger can continue the browser-rooted trace. It is
// OPTIONAL + additive, so it must be fully back-compat on read: old docs that
// predate the field stay valid.
describe('ShoppingListItemSchema traceContext field (back-compat)', () => {
  const baseDoc = {
    id: 'item-1',
    rawText: 'tinned tomatoes',
    notes: '',
    sources: [{ kind: 'manual' as const }],
    canonId: null,
    matchState: 'pending' as const,
    checked: false,
    needsCheck: false,
    schemaVersion: 1 as const,
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  it('parses a doc WITHOUT traceContext (old docs stay valid)', () => {
    const result = ShoppingListItemSchema.safeParse(baseDoc);
    expect(result.success).toBe(true);
    expect(result.success && result.data.traceContext).toBeUndefined();
  });

  it('parses a doc WITH traceContext and carries the string through', () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const result = ShoppingListItemSchema.safeParse({ ...baseDoc, traceContext: traceparent });
    expect(result.success).toBe(true);
    expect(result.success && result.data.traceContext).toBe(traceparent);
  });
});

// Per-form demand breakdown (issue #501, #518). A product-form row carries each
// form's UNROUNDED parent-count so the display layer can sum a form's demand
// ACROSS recipes and round once. OPTIONAL + additive: every item written before
// the field — and every ordinary non-form item, which never has one — must stay
// valid on read and simply degrade to the old MAX rule. Back-compat here is the
// whole reason #518 needs no migration: production shopping lists hold real data
// and self-heal as recipes are re-added.
describe('ShoppingListItemSchema formDemand field (back-compat)', () => {
  const baseDoc = {
    id: 'item-1',
    rawText: 'lime zest',
    notes: '',
    sources: [{ kind: 'recipe' as const, recipeId: 'r1', servings: 2 }],
    canonId: 'canon-lime',
    matchState: 'matched' as const,
    amount: 2,
    unit: 'count',
    checked: false,
    needsCheck: false,
    schemaVersion: 1 as const,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };

  it('parses a product-form doc WITHOUT formDemand (old docs stay valid)', () => {
    // The degrade path's precondition: a pre-#518 count row still reads back, with
    // formDemand simply absent — it must not fail validation or be defaulted to [].
    const result = ShoppingListItemSchema.safeParse(baseDoc);
    expect(result.success).toBe(true);
    expect(result.success && result.data.formDemand).toBeUndefined();
  });

  it('parses an ordinary non-form doc without formDemand', () => {
    // Most items are not product forms and will never carry the field.
    const result = ShoppingListItemSchema.safeParse({
      ...baseDoc,
      rawText: 'caster sugar',
      amount: 150,
      unit: 'g',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.formDemand).toBeUndefined();
  });

  it('parses a doc WITH formDemand and carries every entry through', () => {
    const formDemand = [
      { formId: 'pf-egg-white', parentCount: 3 },
      { formId: 'pf-egg-yolk', parentCount: 2 },
    ];
    const result = ShoppingListItemSchema.safeParse({ ...baseDoc, formDemand });
    expect(result.success).toBe(true);
    expect(result.success && result.data.formDemand).toEqual(formDemand);
  });

  it('preserves a FRACTIONAL parentCount (the unrounded demand must survive the round-trip)', () => {
    // If the schema coerced this to an integer, the round-once-on-the-sum rule
    // would be destroyed at the storage boundary: 1.2 + 1.2 = 2.4 → 3 limes would
    // become 1 + 1 = 2, or 2 + 2 = 4.
    const result = ShoppingListItemSchema.safeParse({
      ...baseDoc,
      formDemand: [{ formId: 'pf-lime-zest', parentCount: 1.2 }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.formDemand?.[0].parentCount).toBe(1.2);
  });

  it('parses an empty formDemand array (degrades to legacy, not to zero demand)', () => {
    const result = ShoppingListItemSchema.safeParse({ ...baseDoc, formDemand: [] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.formDemand).toEqual([]);
  });

  it('rejects a malformed formDemand entry', () => {
    // Trust boundary: a Firestore doc with a broken breakdown must not read back
    // as a silently wrong parent count.
    expect(
      ShoppingListItemSchema.safeParse({
        ...baseDoc,
        formDemand: [{ formId: 'pf-lime-zest', parentCount: 'two' }],
      }).success,
    ).toBe(false);
    expect(
      ShoppingListItemSchema.safeParse({ ...baseDoc, formDemand: [{ parentCount: 2 }] }).success,
    ).toBe(false);
  });
});
