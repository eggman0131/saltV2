import { describe, it, expectTypeOf } from 'vitest';
import type {
  CanonLocalStorePort,
  CursorScope,
  AisleLocalStorePort,
  CanonItem,
  Aisle,
} from '@salt/domain';
import type { ReadResult, DomainError } from '@salt/shared-types';

// ─── CursorScope ────────────────────────────────────────────────────────────

describe('CursorScope', () => {
  it("is the union 'items' | 'aisles'", () => {
    expectTypeOf<CursorScope>().toEqualTypeOf<'items' | 'aisles'>();
  });
});

// ─── CanonLocalStorePort ────────────────────────────────────────────────────

describe('CanonLocalStorePort', () => {
  it('getCursor accepts CursorScope and returns number | null', () => {
    expectTypeOf<CanonLocalStorePort['getCursor']>().toEqualTypeOf<
      (scope: CursorScope) => Promise<ReadResult<number | null, DomainError>>
    >();
  });

  it('setCursor accepts CursorScope and number', () => {
    expectTypeOf<CanonLocalStorePort['setCursor']>().toEqualTypeOf<
      (scope: CursorScope, value: number) => Promise<ReadResult<void, DomainError>>
    >();
  });

  it('drainPendingWrites returns CanonItem array', () => {
    expectTypeOf<CanonLocalStorePort['drainPendingWrites']>().toEqualTypeOf<
      () => Promise<ReadResult<CanonItem[], DomainError>>
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
