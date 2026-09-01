import { describe, it, expect } from 'vitest';
import { SHOPPING_BEHAVIORS, CANON_ITEM_UNITS } from '@salt/shared-types';

// The pin (issue #1145): these tuples are the single source for eleven schema
// sites (Phase 4). A later edit to either list — an add, a remove, a reorder —
// must fail this test rather than silently widen a production schema.
describe('canon vocabulary tuples', () => {
  it('SHOPPING_BEHAVIORS is exactly [stocked, check, needed], in order', () => {
    expect(SHOPPING_BEHAVIORS).toEqual(['stocked', 'check', 'needed']);
  });

  it('CANON_ITEM_UNITS is exactly [g, ml, count], in order', () => {
    expect(CANON_ITEM_UNITS).toEqual(['g', 'ml', 'count']);
  });
});
