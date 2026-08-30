// Type-level test: the `traceContext` narrowing `ShoppingListItem` makes over
// `ShoppingListItemSchema` (issue #932). Companion to
// tests/canon/canonItem.types.test-d.ts — same invariant, second type.
//
// `traceContext` is transport: the browser stamps it onto the doc at "add to
// shopping list" so the onShoppingListItemWrite trigger can continue the
// browser-rooted trace. The pure-domain item must not carry it (CLAUDE.md
// Rule 1). Nothing else enforces that — the runtime suites cannot see a type,
// and `tsc --build` is rooted at `src/` and never compiles `tests/`.
//
// Compiled by the `typecheck` block in packages/domain/vitest.config.ts.
import { describe, it, expectTypeOf } from 'vitest';
import type { ShoppingListItem } from '@salt/domain';
import type { ShoppingListItemDoc } from '@salt/domain/schemas';

describe('ShoppingListItem narrows ShoppingListItemSchema', () => {
  it('omits traceContext — transport only, never the pure domain', () => {
    expectTypeOf<'traceContext'>().not.toExtend<keyof ShoppingListItem>();
  });

  it('leaves traceContext on the schema side — the narrowing is the entity’s alone', () => {
    expectTypeOf<'traceContext'>().toExtend<keyof ShoppingListItemDoc>();
  });

  it('carries every other field straight from the schema', () => {
    expectTypeOf<ShoppingListItem>().toEqualTypeOf<Omit<ShoppingListItemDoc, 'traceContext'>>();
  });
});
