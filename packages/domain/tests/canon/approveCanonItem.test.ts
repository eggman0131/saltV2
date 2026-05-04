import { describe, it, expect } from 'vitest';
import { approveCanonItem } from '@salt/domain';
import type { CanonItem } from '@salt/domain';

const base: CanonItem = {
  id: 'item-1',
  schemaVersion: 3,
  name: 'Flour',
  synonyms: [],
  aisleId: null,
  thumbnail: null,
  embedding: null,
  needs_approval: true,
  shoppingBehavior: 'needed',
  updatedAt: '',
  revision: 0,
  deletedAt: null,
};

describe('approveCanonItem', () => {
  it('sets needs_approval to false', () => {
    const result = approveCanonItem(base);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.needs_approval).toBe(false);
  });

  it('preserves all other fields when no overrides supplied', () => {
    const result = approveCanonItem(base);
    if (result.kind !== 'ok') return;
    expect(result.value.shoppingBehavior).toBe('needed');
    expect(result.value.name).toBe('Flour');
    expect(result.value.id).toBe('item-1');
    expect(result.value.largeQuantityThreshold).toBeUndefined();
  });

  it('applies shoppingBehavior override', () => {
    const result = approveCanonItem(base, { shoppingBehavior: 'stocked' });
    if (result.kind !== 'ok') return;
    expect(result.value.shoppingBehavior).toBe('stocked');
    expect(result.value.needs_approval).toBe(false);
  });

  it('applies "check" as shoppingBehavior override', () => {
    const result = approveCanonItem(base, { shoppingBehavior: 'check' });
    if (result.kind !== 'ok') return;
    expect(result.value.shoppingBehavior).toBe('check');
  });

  it('applies largeQuantityThreshold override', () => {
    const result = approveCanonItem(base, { largeQuantityThreshold: 500 });
    if (result.kind !== 'ok') return;
    expect(result.value.largeQuantityThreshold).toBe(500);
  });

  it('applies both shoppingBehavior and largeQuantityThreshold overrides together', () => {
    const result = approveCanonItem(base, {
      shoppingBehavior: 'check',
      largeQuantityThreshold: 250,
    });
    if (result.kind !== 'ok') return;
    expect(result.value.shoppingBehavior).toBe('check');
    expect(result.value.largeQuantityThreshold).toBe(250);
    expect(result.value.needs_approval).toBe(false);
  });

  it('does not set largeQuantityThreshold when override is omitted', () => {
    const result = approveCanonItem(base, { shoppingBehavior: 'stocked' });
    if (result.kind !== 'ok') return;
    expect(result.value).not.toHaveProperty('largeQuantityThreshold');
  });

  it('preserves existing largeQuantityThreshold when no override supplied', () => {
    const itemWithThreshold: CanonItem = { ...base, largeQuantityThreshold: 100 };
    const result = approveCanonItem(itemWithThreshold);
    if (result.kind !== 'ok') return;
    expect(result.value.largeQuantityThreshold).toBe(100);
  });
});
