import { describe, it, expectTypeOf } from 'vitest';
import type { CanonLocalStorePort, AisleLocalStorePort, CanonItem, Aisle } from '@salt/domain';
import type { ReadResult, DomainError } from '@salt/shared-types';

// ─── CanonLocalStorePort ────────────────────────────────────────────────────

describe('CanonLocalStorePort', () => {
  it('exposes only { upsert, load, list, delete }', () => {
    expectTypeOf<keyof CanonLocalStorePort>().toEqualTypeOf<
      'upsert' | 'load' | 'list' | 'delete'
    >();
  });

  it('upsert accepts CanonItem and returns ReadResult<CanonItem>', () => {
    expectTypeOf<CanonLocalStorePort['upsert']>().toEqualTypeOf<
      (item: CanonItem) => Promise<ReadResult<CanonItem, DomainError>>
    >();
  });

  it('load accepts id and returns ReadResult<CanonItem | null>', () => {
    expectTypeOf<CanonLocalStorePort['load']>().toEqualTypeOf<
      (id: string) => Promise<ReadResult<CanonItem | null, DomainError>>
    >();
  });

  it('list returns ReadResult<readonly CanonItem[]>', () => {
    expectTypeOf<CanonLocalStorePort['list']>().toEqualTypeOf<
      () => Promise<ReadResult<readonly CanonItem[], DomainError>>
    >();
  });

  it('delete accepts id and returns ReadResult<void>', () => {
    expectTypeOf<CanonLocalStorePort['delete']>().toEqualTypeOf<
      (id: string) => Promise<ReadResult<void, DomainError>>
    >();
  });
});

// ─── AisleLocalStorePort ────────────────────────────────────────────────────

describe('AisleLocalStorePort', () => {
  it('exposes only { save, load }', () => {
    expectTypeOf<keyof AisleLocalStorePort>().toEqualTypeOf<'save' | 'load'>();
  });

  it('save accepts aisles and returns ReadResult<void>', () => {
    expectTypeOf<AisleLocalStorePort['save']>().toEqualTypeOf<
      (aisles: readonly Aisle[]) => Promise<ReadResult<void, DomainError>>
    >();
  });

  it('load returns readonly Aisle[] | null', () => {
    expectTypeOf<AisleLocalStorePort['load']>().toEqualTypeOf<
      () => Promise<ReadResult<readonly Aisle[] | null, DomainError>>
    >();
  });
});
