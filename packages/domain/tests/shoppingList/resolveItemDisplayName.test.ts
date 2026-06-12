import { describe, it, expect } from 'vitest';
import { resolveItemDisplayName } from '@salt/domain';
import type { ShoppingListItem } from '@salt/domain';
import type { CanonInfo } from '../../src/shoppingList/queries/groupItemsByAisle.js';

const NOW = '2026-01-01T00:00:00.000Z';

function makeItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: 'i1',
    rawText: '1 banana mashed (0.75)',
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

const CANON: CanonInfo = { id: 'c1', name: 'Banana', aisleId: 'aisle-1' };
const canonMap = new Map<string, CanonInfo>([[CANON.id, CANON]]);
const liveCanonIds = new Set(canonMap.keys());

describe('resolveItemDisplayName', () => {
  it('labels a live-matched item by its canon name', () => {
    const item = makeItem({ matchState: 'matched', canonId: 'c1' });
    expect(resolveItemDisplayName(item, canonMap, liveCanonIds)).toEqual({
      text: 'Banana',
      source: 'canon',
    });
  });

  it('treats needs_approval as a live match (canon name)', () => {
    const item = makeItem({ matchState: 'needs_approval', canonId: 'c1' });
    expect(resolveItemDisplayName(item, canonMap, liveCanonIds)).toEqual({
      text: 'Banana',
      source: 'canon',
    });
  });

  it('falls back to rawText for pending items', () => {
    const item = makeItem({ matchState: 'pending' });
    expect(resolveItemDisplayName(item, canonMap, liveCanonIds)).toEqual({
      text: '1 banana mashed (0.75)',
      source: 'raw',
    });
  });

  it('falls back to rawText when the matched canon has been deleted', () => {
    const item = makeItem({ matchState: 'matched', canonId: 'deleted-canon' });
    expect(resolveItemDisplayName(item, canonMap, liveCanonIds)).toEqual({
      text: '1 banana mashed (0.75)',
      source: 'raw',
    });
  });

  it('falls back to rawText for failed items', () => {
    const item = makeItem({ matchState: 'failed' });
    expect(resolveItemDisplayName(item, canonMap, liveCanonIds).source).toBe('raw');
  });
});
