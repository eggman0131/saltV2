import { describe, it, expect } from 'vitest';
import { createCanonItem } from '@salt/domain';
import type { IdGenerator } from '@salt/domain';
import { ErrorCode } from '@salt/shared-types';

function counterIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return {
    newCanonId: () => `${prefix}-${++n}`,
  };
}

describe('createCanonItem', () => {
  it('returns Success with a CanonItem when name is valid', () => {
    const result = createCanonItem({ name: '  Tomato  ' }, counterIds());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value).toEqual({
      id: 'id-1',
      name: 'Tomato',
      synonyms: [],
      aisle: null,
      thumbnail: null,
      embedding: null,
      needs_approval: true,
    });
  });

  it('uses the IdGenerator for the new id', () => {
    const ids = counterIds('canon');
    const a = createCanonItem({ name: 'Tomato' }, ids);
    const b = createCanonItem({ name: 'Onion' }, ids);
    expect(a.kind === 'ok' && a.value.id).toBe('canon-1');
    expect(b.kind === 'ok' && b.value.id).toBe('canon-2');
  });

  it('trims and drops empty synonyms', () => {
    const result = createCanonItem(
      { name: 'Tomato', synonyms: [' tom ', '', '   ', 'tomate'] },
      counterIds(),
    );
    expect(result.kind === 'ok' && result.value.synonyms).toEqual(['tom', 'tomate']);
  });

  it('preserves aisle when supplied', () => {
    const result = createCanonItem({ name: 'Tomato', aisle: 'produce' }, counterIds());
    expect(result.kind === 'ok' && result.value.aisle).toBe('produce');
  });

  it('returns Failure with INVALID_CANON_NAME when name is blank', () => {
    const result = createCanonItem({ name: '   ' }, counterIds());
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error).toEqual({
      kind: 'ValidationError',
      code: ErrorCode.INVALID_CANON_NAME,
    });
  });

  it('returns Failure when name is empty', () => {
    const result = createCanonItem({ name: '' }, counterIds());
    expect(result.kind === 'err' && result.error.kind).toBe('ValidationError');
  });
});
