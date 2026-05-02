import { describe, it, expectTypeOf } from 'vitest';
import type {
  CanonLocalStorePort,
  CursorScope,
  CanonSyncTransportPort,
  SyncBatch,
  SyncPending,
  ManifestTick,
  AisleSyncTransportPort,
  AisleSyncBatch,
  AisleLocalStorePort,
  CanonItem,
  Aisle,
  AislesDocument,
} from '@salt/domain';
import type { ReadResult, WriteResult, DomainError } from '@salt/shared-types';

// ─── CursorScope ────────────────────────────────────────────────────────────

describe('CursorScope', () => {
  it("is the union 'items' | 'aisles'", () => {
    expectTypeOf<CursorScope>().toEqualTypeOf<'items' | 'aisles'>();
  });
});

// ─── ManifestTick ───────────────────────────────────────────────────────────

describe('ManifestTick', () => {
  it('has numeric itemsRevision', () => {
    expectTypeOf<ManifestTick['itemsRevision']>().toEqualTypeOf<number>();
  });
  it('has numeric aislesRevision', () => {
    expectTypeOf<ManifestTick['aislesRevision']>().toEqualTypeOf<number>();
  });
});

// ─── SyncBatch ──────────────────────────────────────────────────────────────

describe('SyncBatch', () => {
  it('upserted is readonly CanonItem array', () => {
    expectTypeOf<SyncBatch['upserted']>().toEqualTypeOf<readonly CanonItem[]>();
  });
  it('deleted is readonly string array', () => {
    expectTypeOf<SyncBatch['deleted']>().toEqualTypeOf<readonly string[]>();
  });
  it('cursor is a number', () => {
    expectTypeOf<SyncBatch['cursor']>().toEqualTypeOf<number>();
  });
});

// ─── SyncPending ────────────────────────────────────────────────────────────

describe('SyncPending', () => {
  it('has boolean flags for initialSync, pull, push', () => {
    expectTypeOf<SyncPending['initialSync']>().toEqualTypeOf<boolean>();
    expectTypeOf<SyncPending['pull']>().toEqualTypeOf<boolean>();
    expectTypeOf<SyncPending['push']>().toEqualTypeOf<boolean>();
  });
});

// ─── CanonSyncTransportPort ─────────────────────────────────────────────────

describe('CanonSyncTransportPort', () => {
  it('pull accepts number | null cursor and returns ReadResult<SyncBatch>', () => {
    expectTypeOf<CanonSyncTransportPort['pull']>().toEqualTypeOf<
      (sinceCursor: number | null) => Promise<ReadResult<SyncBatch, DomainError>>
    >();
  });

  it('push returns WriteResult (may be Conflict)', () => {
    expectTypeOf<CanonSyncTransportPort['push']>().toEqualTypeOf<
      (item: CanonItem) => Promise<WriteResult<CanonItem, DomainError>>
    >();
  });

  it('subscribe accepts SyncBatch callback and returns unsubscribe fn', () => {
    expectTypeOf<CanonSyncTransportPort['subscribe']>().toEqualTypeOf<
      (onChange: (batch: SyncBatch) => void, onError: (err: DomainError) => void) => () => void
    >();
  });

  it('pending is a readonly SyncPending', () => {
    expectTypeOf<CanonSyncTransportPort['pending']>().toEqualTypeOf<SyncPending>();
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

// ─── AisleSyncBatch ─────────────────────────────────────────────────────────

describe('AisleSyncBatch', () => {
  it('aisles is readonly Aisle array', () => {
    expectTypeOf<AisleSyncBatch['aisles']>().toEqualTypeOf<readonly Aisle[]>();
  });
  it('cursor is a number', () => {
    expectTypeOf<AisleSyncBatch['cursor']>().toEqualTypeOf<number>();
  });
});

// ─── AisleSyncTransportPort ─────────────────────────────────────────────────

describe('AisleSyncTransportPort', () => {
  it('pull accepts number | null and returns AisleSyncBatch | null', () => {
    expectTypeOf<AisleSyncTransportPort['pull']>().toEqualTypeOf<
      (sinceCursor: number | null) => Promise<ReadResult<AisleSyncBatch | null, DomainError>>
    >();
  });

  it('push accepts aisles + baseRevision and returns WriteResult<AislesDocument>', () => {
    expectTypeOf<AisleSyncTransportPort['push']>().toEqualTypeOf<
      (
        aisles: readonly Aisle[],
        baseRevision: number,
      ) => Promise<WriteResult<AislesDocument, DomainError>>
    >();
  });

  it('subscribe accepts ManifestTick callback and returns unsubscribe fn', () => {
    expectTypeOf<AisleSyncTransportPort['subscribe']>().toEqualTypeOf<
      (onTick: (tick: ManifestTick) => void, onError: (err: DomainError) => void) => () => void
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
