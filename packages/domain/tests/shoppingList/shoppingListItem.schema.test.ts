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
