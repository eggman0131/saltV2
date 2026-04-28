import { describe, it, expect } from 'vitest';
import { createCanonLookup } from '@salt/domain';
import type { CanonItem, CanonStorePort } from '@salt/domain';
import { success, failure } from '@salt/shared-types';
import type { ReadResult, DomainError } from '@salt/shared-types';

const seed: readonly CanonItem[] = [
  {
    id: '1',
    name: 'Tomato',
    synonyms: ['tom', 'tomate'],
    aisle: 'produce',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  },
  {
    id: '2',
    name: 'Olive Oil',
    synonyms: ['EVOO'],
    aisle: 'oils',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
  },
];

function fakeStore(
  items: readonly CanonItem[] = seed,
  override?: () => Promise<ReadResult<readonly CanonItem[], DomainError>>,
): CanonStorePort {
  return {
    async save() {
      return success(undefined);
    },
    async load() {
      return success(null);
    },
    async list() {
      return override ? override() : success(items);
    },
    async delete() {
      return success(undefined);
    },
  };
}

describe('createCanonLookup', () => {
  it('loads items once and exposes a synchronous lookup', async () => {
    const result = await createCanonLookup(fakeStore());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const lookup = result.value;

    expect(lookup.findClosestMatch('tom')?.item.id).toBe('1');
    expect(lookup.findClosestMatch('  TOMATO  ')?.item.id).toBe('1');
    expect(lookup.findClosestMatch('evoo')?.item.id).toBe('2');
    expect(lookup.findClosestMatch('butter')).toBeNull();
    expect(lookup.findClosestMatch('   ')).toBeNull();
  });

  it('exposes normaliseName', async () => {
    const result = await createCanonLookup(fakeStore());
    expect(result.kind === 'ok' && result.value.normaliseName('  TOMATO  ')).toBe('tomato');
  });

  it('does not re-fetch on subsequent lookups', async () => {
    let listCalls = 0;
    const store = fakeStore(undefined, async () => {
      listCalls += 1;
      return success(seed);
    });
    const result = await createCanonLookup(store);
    if (result.kind !== 'ok') throw new Error('setup failed');
    result.value.findClosestMatch('tom');
    result.value.findClosestMatch('evoo');
    result.value.findClosestMatch('not there');
    expect(listCalls).toBe(1);
  });

  it('refresh replaces the cached set without reconstructing the port', async () => {
    const result = await createCanonLookup(fakeStore());
    if (result.kind !== 'ok') throw new Error('setup failed');
    const lookup = result.value;

    expect(lookup.findClosestMatch('tom')?.item.id).toBe('1');

    lookup.refresh([
      {
        id: '99',
        name: 'Butter',
        synonyms: [],
        aisle: 'dairy',
        thumbnail: null,
        embedding: null,
        needs_approval: false,
      },
    ]);

    expect(lookup.findClosestMatch('tom')).toBeNull();
    expect(lookup.findClosestMatch('butter')?.item.id).toBe('99');
  });

  it('propagates Failure from the store', async () => {
    const store = fakeStore(undefined, async () =>
      failure({ kind: 'NetworkError', reason: 'offline' }),
    );
    const result = await createCanonLookup(store);
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('NetworkError');
  });
});
