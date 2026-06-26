import { describe, it, expect } from 'vitest';
import { resolveItemDisplayName } from '@salt/domain';
import type { ShoppingListItem } from '@salt/domain';

const NOW = '2026-01-01T00:00:00.000Z';

function makeItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: 'i1',
    rawText: 'mature cheddar cheese',
    notes: '',
    sources: [{ kind: 'manual' }],
    canonId: null,
    matchState: 'pending',
    checked: false,
    needsCheck: false,
    schemaVersion: 1 as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('resolveItemDisplayName', () => {
  it('keeps the descriptive wording when there is nothing to strip', () => {
    expect(resolveItemDisplayName(makeItem({ rawText: 'mature cheddar cheese' }))).toBe(
      'mature cheddar cheese',
    );
  });

  it('strips a leading quantity but keeps descriptive words ("whole")', () => {
    expect(resolveItemDisplayName(makeItem({ rawText: '2 whole chickens' }))).toBe(
      'whole chickens',
    );
  });

  it('strips a number-attached unit', () => {
    expect(resolveItemDisplayName(makeItem({ rawText: '400g spaghetti' }))).toBe('spaghetti');
  });

  it('strips a trailing "for …" context', () => {
    expect(resolveItemDisplayName(makeItem({ rawText: 'flour for the cake' }))).toBe('flour');
  });

  it('labels recipe rows exactly like manual rows (parsed name, not canon name)', () => {
    const recipe = makeItem({
      rawText: '100ml double cream',
      sources: [{ kind: 'recipe', recipeId: 'r1', servings: 4 }],
    });
    expect(resolveItemDisplayName(recipe)).toBe('double cream');
  });

  it('parses regardless of match state — a pending/failed row still drops the quantity', () => {
    expect(resolveItemDisplayName(makeItem({ rawText: '1 onion', matchState: 'pending' }))).toBe(
      'onion',
    );
    expect(resolveItemDisplayName(makeItem({ rawText: '1 onion', matchState: 'failed' }))).toBe(
      'onion',
    );
  });
});
