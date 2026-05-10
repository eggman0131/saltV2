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
  it('save accepts aisles + revision and returns ReadResult<void>', () => {
    expectTypeOf<AisleLocalStorePort['save']>().toEqualTypeOf<
      (aisles: readonly Aisle[], revision: number) => Promise<ReadResult<void, DomainError>>
    >();
  });

  it('load returns { aisles, revision } | null', () => {
    expectTypeOf<AisleLocalStorePort['load']>().toEqualTypeOf<
      () => Promise<
        ReadResult<
          { readonly aisles: readonly Aisle[]; readonly revision: number } | null,
          DomainError
        >
      >
    >();
  });

  it('enqueuePendingSave accepts aisles and returns ReadResult<void>', () => {
    expectTypeOf<AisleLocalStorePort['enqueuePendingSave']>().toEqualTypeOf<
      (aisles: readonly Aisle[]) => Promise<ReadResult<void, DomainError>>
    >();
  });

  it('drainPendingSave returns aisles | null', () => {
    expectTypeOf<AisleLocalStorePort['drainPendingSave']>().toEqualTypeOf<
      () => Promise<ReadResult<readonly Aisle[] | null, DomainError>>
    >();
  });
});
