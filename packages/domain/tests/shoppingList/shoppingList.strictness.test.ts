/**
 * `ShoppingListSchema` REFUSES an incomplete document (issue #1114).
 *
 * The list schema is the same five-line shape as the row's, defaulted the same
 * way, with a strictly worse failure: `id` is the path segment every row read
 * and write inside the list is built from, so a blank one makes the whole list
 * unreachable rather than one row inert.
 *
 * Every row below fails on `main` and passes here. Its sibling
 * `shoppingListItem.strictness.test.ts` carries the full reasoning and the limit
 * of the audit that licensed the narrowing.
 */
import { describe, it, expect } from 'vitest';
import { ShoppingListSchema } from '@salt/domain/schemas';

/** A complete list, exactly as `createShoppingList` writes one. */
const COMPLETE = {
  id: 'list-1',
  name: 'Weekly Shop',
  schemaVersion: 1 as const,
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
};

const REQUIRED = ['id', 'name', 'schemaVersion', 'createdAt', 'updatedAt'] as const;

describe('ShoppingListSchema — a complete document still reads', () => {
  it('accepts the shape createShoppingList produces', () => {
    expect(ShoppingListSchema.safeParse(COMPLETE).success).toBe(true);
  });
});

describe('ShoppingListSchema — an incomplete document is REFUSED', () => {
  it('refuses the empty object outright', () => {
    expect(ShoppingListSchema.safeParse({}).success).toBe(false);
  });

  it.each(REQUIRED)('refuses a document with no %s', (missing) => {
    const doc: Record<string, unknown> = { ...COMPLETE };
    delete doc[missing];
    expect(ShoppingListSchema.safeParse(doc).success).toBe(false);
  });
});

describe('ShoppingListSchema — what was already refused stays refused', () => {
  it.each([
    ['a wrongly-typed name', { name: 42 }],
    ['a null id', { id: null }],
    ['a schemaVersion of 2', { schemaVersion: 2 }],
  ])('refuses %s', (_name, overrides) => {
    expect(ShoppingListSchema.safeParse({ ...COMPLETE, ...overrides }).success).toBe(false);
  });
});
