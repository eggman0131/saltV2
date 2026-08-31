import { describe, expect, it } from 'vitest';
import { ShoppingListItemSchema } from '../../src/schemas/shoppingListItem.js';
import { addItem } from '../../src/index.js';
import type { SourceRef } from '../../src/index.js';
import type { IdGenerator } from '../../src/shoppingList/ports/IdGenerator.js';

// `measureNote` carries the recipe's original non-metric measure ("6 cloves")
// onto a shopping row, so a line the parser flattened to grams still says what to
// reach for. It is additive: the Shopping List collection holds real production
// data, so every document written before the field must still read.

const ids: IdGenerator = { newListId: () => 'l1', newItemId: () => 'i1' };
const source: SourceRef = { kind: 'recipe', recipeId: 'r1', servings: 4, label: 'Roast' };

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    rawText: 'garlic',
    notes: '',
    sources: [{ kind: 'recipe', recipeId: 'r1', servings: 4 }],
    canonId: 'c1',
    matchState: 'matched',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('ShoppingListItemSchema — measureNote', () => {
  it('reads a document carrying the note', () => {
    const result = ShoppingListItemSchema.safeParse(doc({ measureNote: '6 cloves' }));
    expect(result.success).toBe(true);
    expect(result.data?.measureNote).toBe('6 cloves');
  });

  it('reads a document written before the field, leaving it absent', () => {
    // Back-compat: no placeholder, no empty string — the row simply has no note.
    const result = ShoppingListItemSchema.safeParse(doc());
    expect(result.success).toBe(true);
    expect(result.data?.measureNote).toBeUndefined();
  });
});

describe('addItem — measureNote', () => {
  it('carries the note onto the new item', () => {
    const result = addItem(
      [],
      { rawText: 'garlic', source, now: 'n', measureNote: '6 cloves' },
      ids,
    );
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.value[0]?.measureNote).toBe('6 cloves');
  });

  it('omits the key entirely when there is no note', () => {
    // Firestore rejects an explicit `undefined`, so the key must be ABSENT.
    const result = addItem([], { rawText: 'garlic', source, now: 'n' }, ids);
    expect(result.kind === 'ok' && 'measureNote' in result.value[0]!).toBe(false);
  });
});
