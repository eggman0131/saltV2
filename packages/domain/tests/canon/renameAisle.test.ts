import { describe, it, expect } from 'vitest';
import { renameAisle } from '@salt/domain';
import type { AisleLocalStorePort } from '@salt/domain';
import type { Aisle } from '../../src/canon/entities/Aisle.js';
import { ErrorCode } from '@salt/shared-types';

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

const BASE = [
  { id: 'a1', name: 'Produce', order: 0 },
  { id: 'a2', name: 'Dairy', order: 1 },
];

describe('renameAisle', () => {
  it('renames an aisle successfully', async () => {
    const result = await renameAisle({ id: 'a1', newName: 'Fresh Produce' }, makeAisleStore(BASE));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toMatchObject({ id: 'a1', name: 'Fresh Produce', order: 0 });
  });

  it('trims whitespace from new name', async () => {
    const result = await renameAisle({ id: 'a1', newName: '  Fruit  ' }, makeAisleStore(BASE));
    expect(result.kind === 'ok' && result.value.name).toBe('Fruit');
  });

  it('returns INVALID_AISLE_NAME for blank new name', async () => {
    const result = await renameAisle({ id: 'a1', newName: '   ' }, makeAisleStore(BASE));
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.INVALID_AISLE_NAME });
  });

  it('returns NotFound when aisle id does not exist', async () => {
    const result = await renameAisle({ id: 'missing', newName: 'X' }, makeAisleStore(BASE));
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'NotFound', resource: 'aisle', id: 'missing' });
  });

  it('returns DUPLICATE_AISLE_NAME when new name matches another aisle (case-insensitive)', async () => {
    const result = await renameAisle({ id: 'a1', newName: 'dairy' }, makeAisleStore(BASE));
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({ kind: 'ValidationError', code: ErrorCode.DUPLICATE_AISLE_NAME });
  });

  it('allows renaming to the same name (no-op rename)', async () => {
    const result = await renameAisle({ id: 'a1', newName: 'Produce' }, makeAisleStore(BASE));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.name).toBe('Produce');
  });

  it('propagates store load failure', async () => {
    const store: AisleLocalStorePort = {
      load: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      save: async () => ({ kind: 'ok', value: undefined }),
    };
    const result = await renameAisle({ id: 'a1', newName: 'X' }, store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('StorageError');
  });
});
