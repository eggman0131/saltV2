import { describe, it, expect } from 'vitest';
import { listAisles } from '@salt/domain';
import type { AisleLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';

function makeAisleStore(initial: Aisle[] = []): AisleLocalStorePort {
  const items = [...initial];
  return {
    load: async () => ({ kind: 'ok', value: { aisles: items, revision: 0 } }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: undefined };
    },
    enqueuePendingSave: async () => ({ kind: 'ok', value: undefined }),
    drainPendingSave: async () => ({ kind: 'ok', value: null }),
  };
}

describe('listAisles', () => {
  it('returns aisles sorted by order', async () => {
    const store = makeAisleStore([
      { id: 'a3', name: 'Frozen', order: 2 },
      { id: 'a1', name: 'Produce', order: 0 },
      { id: 'a2', name: 'Dairy', order: 1 },
    ]);
    const result = await listAisles(store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns empty array when store has no aisles', async () => {
    const result = await listAisles(makeAisleStore());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(0);
  });

  it('returns empty array when store returns null', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'ok', value: null }),
      save: async () => ({ kind: 'ok', value: undefined }),
      enqueuePendingSave: async () => ({ kind: 'ok', value: undefined }),
      drainPendingSave: async () => ({ kind: 'ok', value: null }),
    };
    const result = await listAisles(store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(0);
  });

  it('propagates store load failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: undefined }),
      enqueuePendingSave: async () => ({ kind: 'ok', value: undefined }),
      drainPendingSave: async () => ({ kind: 'ok', value: null }),
    };
    const result = await listAisles(store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('StorageError');
  });
});
