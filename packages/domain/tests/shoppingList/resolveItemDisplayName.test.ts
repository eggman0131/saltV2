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

const liveCanonIds = new Set(['c1']);

describe('resolveItemDisplayName', () => {
  it("labels a live-matched item by the user's rawText, flagged as canon-backed", () => {
    const item = makeItem({ matchState: 'matched', canonId: 'c1' });
    expect(resolveItemDisplayName(item, liveCanonIds)).toEqual({
      text: 'mature cheddar cheese',
      source: 'canon',
    });
  });

  it('treats needs_approval as a live match (still canon-backed)', () => {
    const item = makeItem({ matchState: 'needs_approval', canonId: 'c1' });
    expect(resolveItemDisplayName(item, liveCanonIds)).toEqual({
      text: 'mature cheddar cheese',
      source: 'canon',
    });
  });

  it('reports source raw for pending items', () => {
    const item = makeItem({ matchState: 'pending' });
    expect(resolveItemDisplayName(item, liveCanonIds)).toEqual({
      text: 'mature cheddar cheese',
      source: 'raw',
    });
  });

  it('reports source raw when the matched canon has been deleted', () => {
    const item = makeItem({ matchState: 'matched', canonId: 'deleted-canon' });
    expect(resolveItemDisplayName(item, liveCanonIds)).toEqual({
      text: 'mature cheddar cheese',
      source: 'raw',
    });
  });

  it('reports source raw for failed items', () => {
    const item = makeItem({ matchState: 'failed' });
    expect(resolveItemDisplayName(item, liveCanonIds).source).toBe('raw');
  });
});
