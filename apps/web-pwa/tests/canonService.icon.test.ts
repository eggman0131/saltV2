import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { CanonItem } from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeCanonItems: vi.fn(),
  subscribeAisles: vi.fn(),
  upsertCanonItem: vi.fn().mockResolvedValue(undefined),
  deleteCanonItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callMatchOrCreate: vi.fn(),
  callRegenerateCanonIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  createObservabilityMatchLoggingAdapter: vi.fn(),
  extractTraceHeaders: vi.fn(() => ({})),
  startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  regenerateCanonIcon,
  hideCanonIcon,
  unhideCanonIcon,
  __resetCanonServiceForTest,
} from '../src/lib/canonService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

function makeItem(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: 'c1',
    schemaVersion: 5,
    name: 'Milk',
    synonyms: [],
    aisleId: null,
    thumbnail: 'https://example.com/old.webp',
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCanonServiceForTest();
});

describe('canonService icon actions', () => {
  it('regenerateCanonIcon calls the regenerate callable', async () => {
    const result = await regenerateCanonIcon('canon-123');
    expect(fs.callRegenerateCanonIcon).toHaveBeenCalledWith('canon-123', undefined);
    expect(result.kind).toBe('ok');
  });

  it('regenerateCanonIcon forwards an optional hint', async () => {
    await regenerateCanonIcon('canon-123', 'show it as a tin');
    expect(fs.callRegenerateCanonIcon).toHaveBeenCalledWith('canon-123', 'show it as a tin');
  });

  it('unhideCanonIcon calls the regenerate callable with no hint', async () => {
    await unhideCanonIcon('canon-123');
    expect(fs.callRegenerateCanonIcon).toHaveBeenCalledWith('canon-123');
  });

  it('hideCanonIcon upserts the item with the hidden sentinel', async () => {
    const result = await hideCanonIcon(makeItem());
    expect(result.kind).toBe('ok');
    expect(fs.upsertCanonItem).toHaveBeenCalledTimes(1);
    const upserted = fs.upsertCanonItem.mock.calls[0]![0] as CanonItem;
    expect(upserted.thumbnail).toBe('hidden');
    // Does not go through the regenerate callable.
    expect(fs.callRegenerateCanonIcon).not.toHaveBeenCalled();
  });
});
