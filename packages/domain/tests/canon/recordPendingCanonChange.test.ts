import { describe, it, expect } from 'vitest';
import { recordPendingCanonChange, describePendingCanonChange } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

const base: CanonItem = {
  id: 'item-1',
  schemaVersion: 5,
  name: 'Tomatoes',
  synonyms: [],
  aisleId: null,
  thumbnail: null,
  embedding: null,
  needs_approval: true,
  shoppingBehavior: 'needed',
  updatedAt: '',
};

describe('recordPendingCanonChange', () => {
  it('starts the array on an item that has no record yet', () => {
    const next = recordPendingCanonChange(base, { kind: 'created' });
    expect(next.pendingChanges).toEqual([{ kind: 'created' }]);
  });

  it('appends, most recent last', () => {
    const a = recordPendingCanonChange(base, { kind: 'created' });
    const b = recordPendingCanonChange(a, { kind: 'synonym_added', synonym: 'passata' });
    const c = recordPendingCanonChange(b, { kind: 'synonym_added', synonym: 'sugo' });
    expect(c.pendingChanges).toEqual([
      { kind: 'created' },
      { kind: 'synonym_added', synonym: 'passata' },
      { kind: 'synonym_added', synonym: 'sugo' },
    ]);
  });

  it('does not mutate the input item', () => {
    recordPendingCanonChange(base, { kind: 'created' });
    expect(base.pendingChanges).toBeUndefined();
  });

  it('carries no timestamp — the domain has no clock, array order is the sequence', () => {
    const next = recordPendingCanonChange(base, { kind: 'created' });
    expect(Object.keys(next.pendingChanges![0]!)).toEqual(['kind']);
  });

  it('leaves needs_approval alone — recording and flagging are separate', () => {
    const approved: CanonItem = { ...base, needs_approval: false };
    expect(recordPendingCanonChange(approved, { kind: 'created' }).needs_approval).toBe(false);
  });
});

describe('describePendingCanonChange', () => {
  it('flattens synonym_added, nulling nothing that is present', () => {
    expect(
      describePendingCanonChange({
        kind: 'synonym_added',
        synonym: 'tin chopped tom',
        rawInput: '2 tins chopped toms',
      }),
    ).toEqual({
      kind: 'synonym_added',
      synonym: 'tin chopped tom',
      rawInput: '2 tins chopped toms',
    });
  });

  it('nulls rawInput when it was omitted (same as the value it produced)', () => {
    expect(describePendingCanonChange({ kind: 'synonym_added', synonym: 'passata' })).toEqual({
      kind: 'synonym_added',
      synonym: 'passata',
      rawInput: null,
    });
  });

  it('nulls synonym for created — it names no synonym', () => {
    expect(describePendingCanonChange({ kind: 'created', rawInput: 'a jar of sugo' })).toEqual({
      kind: 'created',
      synonym: null,
      rawInput: 'a jar of sugo',
    });
  });
});
