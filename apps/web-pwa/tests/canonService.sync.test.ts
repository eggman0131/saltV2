import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { CanonItem, Aisle } from '@salt/domain';

// ─── Mock firebase-sync (no real Firestore in unit tests) ───────────────────────

vi.mock('@salt/firebase-sync', () => ({
  subscribeCanonItems: vi.fn(),
  subscribeAisles: vi.fn(),
  upsertCanonItem: vi.fn().mockResolvedValue(undefined),
  callMatchOrCreate: vi.fn(),
}));

vi.mock('@salt/ld-observability', () => ({
  createLDErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
}));

import * as firebaseSync from '@salt/firebase-sync';

import {
  canonItems,
  aisles,
  aisleUsage,
  isLoadingAisles,
  initCanonSync,
  deleteCanonItem,
  updateCanonItemName,
  updateCanonItemAisle,
  updateCanonItemSynonyms,
  memAisleStore,
  memCanonStore,
  getAislesSnapshot,
  getCanonItemsSnapshot,
  __resetCanonServiceForTest,
} from '../src/lib/canonService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

function makeItem(id: string, overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id,
    schemaVersion: 2,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision: 0,
    deletedAt: null,
    ...overrides,
  };
}

function makeAisle(id: string, name: string, order = 0): Aisle {
  return { id, name, order };
}

// ─── Helper to capture subscription callbacks ───────────────────────────────────

type ItemsCb = (items: CanonItem[]) => void;
type AislesCb = (aisles: Aisle[]) => void;

function wireSubscriptions(): {
  emitItems: (items: CanonItem[]) => void;
  emitAisles: (aisles: Aisle[]) => void;
  unsubItems: ReturnType<typeof vi.fn>;
  unsubAisles: ReturnType<typeof vi.fn>;
} {
  const unsubItems = vi.fn();
  const unsubAisles = vi.fn();
  let itemsCb: ItemsCb | null = null;
  let aislesCb: AislesCb | null = null;

  fs.subscribeCanonItems.mockImplementation((onItems) => {
    itemsCb = onItems as ItemsCb;
    return unsubItems;
  });
  fs.subscribeAisles.mockImplementation((onAisles) => {
    aislesCb = onAisles as AislesCb;
    return unsubAisles;
  });

  return {
    emitItems: (items) => itemsCb!(items),
    emitAisles: (a) => aislesCb!(a),
    unsubItems,
    unsubAisles,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('canonService — subscription-fed stores', () => {
  let stopSync: (() => void) | null = null;

  beforeEach(() => {
    __resetCanonServiceForTest();
    vi.clearAllMocks();
    fs.upsertCanonItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopSync?.();
    stopSync = null;
    __resetCanonServiceForTest();
  });

  it('canonItems starts empty', () => {
    expect(get(canonItems)).toEqual([]);
  });

  it('aisles starts empty', () => {
    expect(get(aisles)).toEqual([]);
  });

  it('isLoadingAisles starts false', () => {
    expect(get(isLoadingAisles)).toBe(false);
  });

  describe('initCanonSync', () => {
    it('sets isLoadingAisles to true on start', () => {
      wireSubscriptions();
      stopSync = initCanonSync();
      expect(get(isLoadingAisles)).toBe(true);
    });

    it('subscribes to items and aisles', () => {
      wireSubscriptions();
      stopSync = initCanonSync();
      expect(fs.subscribeCanonItems).toHaveBeenCalledOnce();
      expect(fs.subscribeAisles).toHaveBeenCalledOnce();
    });

    it('clears loading after both first snapshots arrive', () => {
      const { emitItems, emitAisles } = wireSubscriptions();
      stopSync = initCanonSync();
      expect(get(isLoadingAisles)).toBe(true);

      emitItems([]);
      expect(get(isLoadingAisles)).toBe(true); // still waiting for aisles

      emitAisles([]);
      expect(get(isLoadingAisles)).toBe(false);
    });

    it('populates canonItems from subscription, filtering tombstones', () => {
      const { emitItems } = wireSubscriptions();
      stopSync = initCanonSync();
      const live = makeItem('a');
      const dead = makeItem('b', { deletedAt: '2024-01-01' });
      emitItems([live, dead]);
      expect(get(canonItems)).toEqual([live]);
    });

    it('populates aisles from subscription, sorted by order', () => {
      const { emitAisles } = wireSubscriptions();
      stopSync = initCanonSync();
      emitAisles([makeAisle('z', 'Z', 2), makeAisle('a', 'A', 0), makeAisle('m', 'M', 1)]);
      expect(get(aisles).map((a) => a.id)).toEqual(['a', 'm', 'z']);
    });

    it('recomputes aisleUsage when items arrive', () => {
      const { emitItems, emitAisles } = wireSubscriptions();
      stopSync = initCanonSync();
      emitAisles([makeAisle('aisle1', 'Aisle 1')]);
      emitItems([makeItem('x', { aisleId: 'aisle1' }), makeItem('y', { aisleId: 'aisle1' })]);
      expect(get(aisleUsage).get('aisle1')).toBe(2);
    });

    it('returns cleanup that calls both unsub functions', () => {
      const { unsubItems, unsubAisles } = wireSubscriptions();
      const cleanup = initCanonSync();
      cleanup();
      expect(unsubItems).toHaveBeenCalledOnce();
      expect(unsubAisles).toHaveBeenCalledOnce();
    });
  });
});

describe('canonService — in-memory adapters', () => {
  describe('memAisleStore', () => {
    it('load returns seed aisles', async () => {
      const seed = [makeAisle('a1', 'Produce')];
      const { store } = memAisleStore(seed);
      const result = await store.load();
      expect(result).toEqual({ kind: 'ok', value: { aisles: seed, revision: 0 } });
    });

    it('save captures the new aisles', async () => {
      const { store, getWritten } = memAisleStore([]);
      const newAisles = [makeAisle('a1', 'Dairy')];
      await store.save(newAisles, 0);
      expect(getWritten()).toEqual(newAisles);
    });

    it('getWritten is null before save', () => {
      const { getWritten } = memAisleStore([makeAisle('a', 'A')]);
      expect(getWritten()).toBeNull();
    });

    it('load reflects saved aisles after save', async () => {
      const { store } = memAisleStore([]);
      const updated = [makeAisle('b', 'Bakery')];
      await store.save(updated, 0);
      const result = await store.load();
      expect((result as { kind: 'ok'; value: { aisles: Aisle[] } }).value.aisles).toEqual(updated);
    });
  });

  describe('memCanonStore', () => {
    it('list returns seed items (excluding tombstones)', async () => {
      const seed = [makeItem('a'), makeItem('b', { deletedAt: '2024-01-01' })];
      const { store } = memCanonStore(seed);
      const result = await store.list();
      expect(result).toEqual({ kind: 'ok', value: [makeItem('a')] });
    });

    it('upsert adds item and records it as upserted', async () => {
      const { store, getUpserted } = memCanonStore([]);
      const item = makeItem('x');
      await store.upsert(item);
      const listed = await store.list();
      expect((listed as { kind: 'ok'; value: CanonItem[] }).value).toContainEqual(item);
      expect(getUpserted()).toContainEqual(item);
    });

    it('load returns item by id', async () => {
      const item = makeItem('abc');
      const { store } = memCanonStore([item]);
      const result = await store.load('abc');
      expect(result).toEqual({ kind: 'ok', value: item });
    });

    it('load returns null for unknown id', async () => {
      const { store } = memCanonStore([]);
      const result = await store.load('unknown');
      expect(result).toEqual({ kind: 'ok', value: null });
    });

    it('getUpserted returns all upserted items in order', async () => {
      const { store, getUpserted } = memCanonStore([]);
      const a = makeItem('a');
      const b = makeItem('b');
      await store.upsert(a);
      await store.upsert(b);
      expect(getUpserted()).toEqual([a, b]);
    });
  });
});

describe('canonService — snapshots', () => {
  afterEach(() => {
    __resetCanonServiceForTest();
  });

  it('getAislesSnapshot returns current aisles store value', () => {
    const { emitAisles } = wireSubscriptions();
    const cleanup = initCanonSync();
    emitAisles([makeAisle('a', 'Produce')]);
    expect(getAislesSnapshot()).toEqual([makeAisle('a', 'Produce')]);
    cleanup();
  });

  it('getCanonItemsSnapshot returns current canonItems store value', () => {
    const { emitItems } = wireSubscriptions();
    const cleanup = initCanonSync();
    emitItems([makeItem('x')]);
    expect(getCanonItemsSnapshot()).toEqual([makeItem('x')]);
    cleanup();
  });
});

describe('canonService — commands', () => {
  beforeEach(() => {
    __resetCanonServiceForTest();
    vi.clearAllMocks();
    fs.upsertCanonItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetCanonServiceForTest();
  });

  describe('updateCanonItemName', () => {
    it('calls upsertCanonItem with renamed item on success', async () => {
      const item = makeItem('a', { name: 'apple' });
      const result = await updateCanonItemName(item, 'Apple');
      expect(result.kind).toBe('ok');
      expect(fs.upsertCanonItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Apple' }));
    });

    it('does not call upsertCanonItem on validation failure', async () => {
      const item = makeItem('a', { name: 'apple' });
      const result = await updateCanonItemName(item, '');
      expect(result.kind).toBe('err');
      expect(fs.upsertCanonItem).not.toHaveBeenCalled();
    });
  });

  describe('updateCanonItemAisle', () => {
    it('calls upsertCanonItem with updated aisleId', async () => {
      const item = makeItem('a');
      await updateCanonItemAisle(item, 'aisle-123');
      expect(fs.upsertCanonItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', aisleId: 'aisle-123' }),
      );
    });
  });

  describe('updateCanonItemSynonyms', () => {
    it('calls upsertCanonItem with updated synonyms', async () => {
      const item = makeItem('a');
      await updateCanonItemSynonyms(item, ['alias']);
      expect(fs.upsertCanonItem).toHaveBeenCalledWith(
        expect.objectContaining({ synonyms: ['alias'] }),
      );
    });
  });

  describe('deleteCanonItem', () => {
    it('returns ok and calls upsertCanonItem with tombstone when item exists in store', async () => {
      const { emitItems, emitAisles } = wireSubscriptions();
      const cleanup = initCanonSync();
      emitItems([makeItem('a')]);
      emitAisles([]);

      const result = await deleteCanonItem('a');
      expect(result).toEqual({ kind: 'ok', value: undefined });
      expect(fs.upsertCanonItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', deletedAt: expect.any(String) }),
      );
      cleanup();
    });

    it('returns ok without calling upsertCanonItem when item is not in store', async () => {
      const result = await deleteCanonItem('nonexistent');
      expect(result).toEqual({ kind: 'ok', value: undefined });
      expect(fs.upsertCanonItem).not.toHaveBeenCalled();
    });
  });
});
