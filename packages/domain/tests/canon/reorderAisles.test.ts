import { describe, it, expect } from 'vitest';
import { reorderAisles } from '@salt/domain';
import type { AisleStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';

function makeAisleStore(initial: Aisle[] = []): AisleStorePort & { items: Aisle[] } {
  const items = [...initial];
  return {
    items,
    load: async () => ({ kind: 'ok', value: items }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: items };
    },
  };
}

const BASE = [
  { id: 'a1', name: 'Produce', order: 0 },
  { id: 'a2', name: 'Dairy', order: 1 },
  { id: 'a3', name: 'Frozen', order: 2 },
];

describe('reorderAisles', () => {
  it('reassigns order by index position', async () => {
    const store = makeAisleStore(BASE);
    const result = await reorderAisles({ orderedIds: ['a3', 'a1', 'a2'] }, store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.find((a) => a.id === 'a3')?.order).toBe(0);
    expect(result.value.find((a) => a.id === 'a1')?.order).toBe(1);
    expect(result.value.find((a) => a.id === 'a2')?.order).toBe(2);
  });

  it('skips unknown ids without error', async () => {
    const store = makeAisleStore(BASE);
    const result = await reorderAisles({ orderedIds: ['unknown', 'a1', 'a2'] }, store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.some((a) => a.id === 'unknown')).toBe(false);
    expect(result.value.find((a) => a.id === 'a1')?.order).toBe(0);
  });

  it('appends aisles missing from orderedIds at end in original relative order', async () => {
    const store = makeAisleStore(BASE);
    const result = await reorderAisles({ orderedIds: ['a2'] }, store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.find((a) => a.id === 'a2')?.order).toBe(0);
    expect(result.value.find((a) => a.id === 'a1')?.order).toBe(1);
    expect(result.value.find((a) => a.id === 'a3')?.order).toBe(2);
  });

  it('propagates store load failure', async () => {
    const store: AisleStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: [] }),
    };
    const result = await reorderAisles({ orderedIds: ['a1'] }, store);
    expect(result.kind).toBe('err');
  });
});
