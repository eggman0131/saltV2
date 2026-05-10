import { describe, it, expect } from 'vitest';
import { createAislesBulk } from '@salt/domain';
import type { IdGenerator, AisleLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import { ErrorCode } from '@salt/shared-types';

let n = 0;
function makeIds(): IdGenerator {
  return { newCanonId: () => `canon-${++n}`, newAisleId: () => `aisle-${++n}` };
}

function makeAisleStore(initial: Aisle[] = []): AisleLocalStorePort {
  const items = [...initial];
  return {
    load: async () => ({ kind: 'ok', value: items }),
    save: async (aisles) => {
      items.length = 0;
      items.push(...aisles);
      return { kind: 'ok', value: undefined };
    },
  };
}

describe('createAislesBulk', () => {
  it('creates aisles in submission order appended after existing', async () => {
    const store = makeAisleStore([{ id: 'a0', name: 'Produce', order: 0 }]);
    const result = await createAislesBulk({ names: ['Dairy', 'Frozen'] }, makeIds(), store);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({ name: 'Dairy', order: 1 });
    expect(result.value[1]).toMatchObject({ name: 'Frozen', order: 2 });
  });

  it('deduplicates input names case-insensitively, preserving first casing', async () => {
    const result = await createAislesBulk(
      { names: ['Dairy', 'dairy', 'DAIRY'] },
      makeIds(),
      makeAisleStore(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].name).toBe('Dairy');
  });

  it('filters blank names before processing', async () => {
    const result = await createAislesBulk(
      { names: ['Produce', '  ', 'Dairy'] },
      makeIds(),
      makeAisleStore(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toHaveLength(2);
  });

  it('returns INVALID_AISLE_NAME when all names are blank', async () => {
    const result = await createAislesBulk({ names: ['', '  '] }, makeIds(), makeAisleStore());
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  });

  it('returns DUPLICATE_AISLE_NAME when a name collides with existing (case-insensitive)', async () => {
    const store = makeAisleStore([{ id: 'a1', name: 'Produce', order: 0 }]);
    const result = await createAislesBulk({ names: ['Dairy', 'PRODUCE'] }, makeIds(), store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  });

  it('propagates store load failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await createAislesBulk({ names: ['Produce'] }, makeIds(), store);
    expect(result.kind).toBe('err');
  });
});
