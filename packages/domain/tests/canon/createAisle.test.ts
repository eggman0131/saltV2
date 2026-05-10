import { describe, it, expect } from 'vitest';
import { createAisle } from '@salt/domain';
import type { IdGenerator, AisleLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import { ErrorCode } from '@salt/shared-types';

let n = 0;
function makeIds(): IdGenerator {
  return { newCanonId: () => `canon-${++n}`, newAisleId: () => `aisle-${++n}` };
}

function makeAisleStore(initial: Aisle[] = []): AisleLocalStorePort & { items: Aisle[] } {
  const items = [...initial];
  return {
    items,
    load: async () => ({ kind: 'ok', value: items }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: undefined };
    },
  };
}

describe('createAisle', () => {
  it('creates aisle at order 0 when store is empty', async () => {
    const result = await createAisle({ name: 'Produce' }, makeIds(), makeAisleStore());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toMatchObject({ name: 'Produce', order: 0 });
    expect(result.value.id).toMatch(/^aisle-/);
  });

  it('appends at order = max + 1 when aisles exist', async () => {
    const existing = [
      { id: 'a1', name: 'Produce', order: 0 },
      { id: 'a2', name: 'Dairy', order: 1 },
    ];
    const result = await createAisle({ name: 'Frozen' }, makeIds(), makeAisleStore(existing));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.order).toBe(2);
  });

  it('trims whitespace from name', async () => {
    const result = await createAisle({ name: '  Bakery  ' }, makeIds(), makeAisleStore());
    expect(result.kind === 'ok' && result.value.name).toBe('Bakery');
  });

  it('returns INVALID_AISLE_NAME for blank name', async () => {
    const result = await createAisle({ name: '   ' }, makeIds(), makeAisleStore());
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  });

  it('returns DUPLICATE_AISLE_NAME when name collides (case-insensitive)', async () => {
    const store = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const result = await createAisle({ name: 'produce' }, makeIds(), store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  });

  it('propagates store load failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await createAisle({ name: 'Produce' }, makeIds(), store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('StorageError');
  });

  it('propagates store save failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'ok', value: null }),
      save: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
    };
    const result = await createAisle({ name: 'Produce' }, makeIds(), store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('StorageError');
  });
});
