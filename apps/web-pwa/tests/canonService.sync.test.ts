import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { success, conflict, failure } from '@salt/shared-types';
import type { Conflict, DomainError } from '@salt/shared-types';
import type {
  Aisle,
  AisleLocalStorePort,
  AisleSyncTransportPort,
  AislesDocument,
  CanonItem,
  CanonLocalStorePort,
  CanonSyncTransportPort,
  CursorScope,
  ErrorReportingPort,
  ManifestTick,
  SyncDiagnosticsPort,
  SyncTickEvent,
} from '@salt/domain';

import {
  __setCanonServiceDeps,
  __drainQueuesForTest,
  __getSyncPending,
  __waitForInit,
  __waitForLastTick,
  __resetCanonServiceForTest,
  canonItems,
  aisles,
  aisleConflicts,
  canonConflicts,
  initCanonSync,
  resolveConflict,
  resolveAisleConflict,
  enqueueAisleSave,
  syncHealth,
  syncPending,
} from '../src/lib/canonService.js';

// ─── Fake adapters ─────────────────────────────────────────────────────────────

function makeFakeCanonStore(): CanonLocalStorePort & {
  _items: Map<string, CanonItem>;
  _cursors: Map<CursorScope, number>;
  _pending: Map<string, CanonItem>;
} {
  const _items = new Map<string, CanonItem>();
  const _cursors = new Map<CursorScope, number>();
  const _pending = new Map<string, CanonItem>();
  return {
    _items,
    _cursors,
    _pending,
    async upsert(item) {
      _items.set(item.id, item);
      return success(item);
    },
    async load(id) {
      return success(_items.get(id) ?? null);
    },
    async list() {
      const out = [..._items.values()].filter((i) => i.deletedAt === null);
      return success(out);
    },
    async delete(id) {
      _items.delete(id);
      return success(undefined);
    },
    async getCursor(scope) {
      return success(_cursors.has(scope) ? (_cursors.get(scope) ?? null) : null);
    },
    async setCursor(scope, value) {
      _cursors.set(scope, value);
      return success(undefined);
    },
    async enqueuePendingWrite(item) {
      _pending.set(item.id, item);
      return success(undefined);
    },
    async drainPendingWrites() {
      const out = [..._pending.values()].sort((a, b) => a.id.localeCompare(b.id));
      _pending.clear();
      return success(out);
    },
  };
}

function makeFakeAisleStore(): AisleLocalStorePort & {
  _data: { aisles: readonly Aisle[]; revision: number } | null;
  _pending: readonly Aisle[] | null;
} {
  const state = {
    _data: null as { aisles: readonly Aisle[]; revision: number } | null,
    _pending: null as readonly Aisle[] | null,
  };
  return {
    ...state,
    async save(aislesArr, revision) {
      this._data = { aisles: [...aislesArr], revision };
      return success(undefined);
    },
    async load() {
      return success(this._data);
    },
    async enqueuePendingSave(aislesArr) {
      this._pending = [...aislesArr];
      return success(undefined);
    },
    async drainPendingSave() {
      const out = this._pending;
      this._pending = null;
      return success(out);
    },
  };
}

function makeFakeCanonTransport(): CanonSyncTransportPort & {
  _remote: Map<string, CanonItem>;
  _failNextPush: boolean;
  _pullErr: DomainError | null;
} {
  const _remote = new Map<string, CanonItem>();
  return {
    _remote,
    _failNextPush: false,
    _pullErr: null,
    pending: { initialSync: false, pull: false, push: false, manifestRefresh: false },
    async pull(sinceCursor) {
      if (this._pullErr) return failure(this._pullErr);
      const since = sinceCursor ?? 0;
      const upserted = [..._remote.values()]
        .filter((i) => i.revision > since)
        .sort((a, b) => a.revision - b.revision);
      const cursor = upserted.length > 0 ? upserted[upserted.length - 1]!.revision : since;
      return success({ upserted, deleted: [], cursor });
    },
    async push(item) {
      if (this._failNextPush) {
        this._failNextPush = false;
        return failure({ kind: 'NetworkError', reason: 'offline' } satisfies DomainError);
      }
      const remote = _remote.get(item.id);
      if (remote && remote.revision !== item.revision) {
        return conflict(item, remote);
      }
      const next: CanonItem = { ...item, revision: item.revision + 1 };
      _remote.set(item.id, next);
      return success(next);
    },
    subscribe() {
      return () => {};
    },
  };
}

function makeFakeAisleTransport(): AisleSyncTransportPort & {
  _doc: { aisles: readonly Aisle[]; revision: number } | null;
  _failNextPush: boolean;
} {
  return {
    _doc: null,
    _failNextPush: false,
    async pull(sinceCursor) {
      const since = sinceCursor ?? 0;
      if (!this._doc || this._doc.revision <= since) return success(null);
      return success({ aisles: this._doc.aisles, cursor: this._doc.revision });
    },
    async push(aislesArr, baseRevision) {
      if (this._failNextPush) {
        this._failNextPush = false;
        return failure({ kind: 'NetworkError', reason: 'offline' } satisfies DomainError);
      }
      const remote = this._doc;
      if (remote && remote.revision !== baseRevision) {
        const remoteDoc: AislesDocument = {
          schemaVersion: 1,
          revision: remote.revision,
          updatedAt: '',
          aisles: remote.aisles,
        };
        const localDoc: AislesDocument = {
          schemaVersion: 1,
          revision: baseRevision,
          updatedAt: '',
          aisles: aislesArr,
        };
        return conflict(localDoc, remoteDoc);
      }
      this._doc = { aisles: [...aislesArr], revision: baseRevision + 1 };
      const newDoc: AislesDocument = {
        schemaVersion: 1,
        revision: this._doc.revision,
        updatedAt: new Date().toISOString(),
        aisles: this._doc.aisles,
      };
      return success(newDoc);
    },
    subscribe() {
      return () => {};
    },
  };
}

interface ManifestHarness {
  emit(tick: ManifestTick): void;
  emitError(err: DomainError): void;
  unsubscribed: boolean;
}

function makeManifestHarness(): {
  harness: ManifestHarness;
  subscribeManifest: (
    onTick: (tick: ManifestTick) => void,
    onError: (err: DomainError) => void,
  ) => () => void;
} {
  let onTick: ((tick: ManifestTick) => void) | null = null;
  let onError: ((err: DomainError) => void) | null = null;
  const harness: ManifestHarness = {
    emit(tick) {
      onTick?.(tick);
    },
    emitError(err) {
      onError?.(err);
    },
    unsubscribed: false,
  };
  const subscribeManifest = (t: typeof onTick, e: typeof onError) => {
    onTick = t;
    onError = e;
    return () => {
      harness.unsubscribed = true;
    };
  };
  return { harness, subscribeManifest };
}

interface DiagnosticsRecorder extends SyncDiagnosticsPort {
  events: SyncTickEvent[];
}
function makeDiagnostics(): DiagnosticsRecorder {
  const events: SyncTickEvent[] = [];
  return {
    events,
    syncTick(e) {
      events.push(e);
    },
  };
}

interface ErrorRecorder extends ErrorReportingPort {
  errors: unknown[];
}
function makeErrors(): ErrorRecorder {
  const errors: unknown[] = [];
  return {
    errors,
    report(err) {
      errors.push(err);
    },
  };
}

function makeItem(id: string, revision: number, overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id,
    schemaVersion: 2,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    revision,
    deletedAt: null,
    ...overrides,
  };
}

function makeAisle(id: string, name: string, order: number): Aisle {
  return { id, name, order };
}

// ─── Harness wiring ────────────────────────────────────────────────────────────

interface Harness {
  canonStore: ReturnType<typeof makeFakeCanonStore>;
  aisleStore: ReturnType<typeof makeFakeAisleStore>;
  canonTransport: ReturnType<typeof makeFakeCanonTransport>;
  aisleTransport: ReturnType<typeof makeFakeAisleTransport>;
  manifest: ManifestHarness;
  diagnostics: DiagnosticsRecorder;
  errors: ErrorRecorder;
}

function setupHarness(): Harness {
  const canonStore = makeFakeCanonStore();
  const aisleStore = makeFakeAisleStore();
  const canonTransport = makeFakeCanonTransport();
  const aisleTransport = makeFakeAisleTransport();
  const { harness: manifest, subscribeManifest } = makeManifestHarness();
  const diagnostics = makeDiagnostics();
  const errors = makeErrors();

  __setCanonServiceDeps({
    localCanonStore: canonStore,
    localAisleStore: aisleStore,
    canonTransport,
    aisleTransport,
    errors,
    diagnostics,
    subscribeManifest,
    now: () => 0,
  });

  return { canonStore, aisleStore, canonTransport, aisleTransport, manifest, diagnostics, errors };
}

// Helper: wait for the cold-start IIFE plus a few microtask cycles for any
// follow-up promises chained off it.
async function flush(): Promise<void> {
  await __waitForInit();
  await __waitForLastTick();
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('canonService — manifest-driven sync', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    __resetCanonServiceForTest();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    __setCanonServiceDeps(null);
    __resetCanonServiceForTest();
  });

  it('cold start with no cursors performs full pulls of both scopes', async () => {
    const h = setupHarness();
    h.canonTransport._remote.set('a', makeItem('a', 1));
    h.canonTransport._remote.set('b', makeItem('b', 2));
    h.aisleTransport._doc = { aisles: [makeAisle('aisle-1', 'Produce', 0)], revision: 1 };

    cleanup = initCanonSync();
    await flush();

    expect(h.canonStore._items.size).toBe(2);
    expect(h.canonStore._cursors.get('items')).toBe(2);
    expect(h.aisleStore._data?.revision).toBe(1);
    expect(h.aisleStore._data?.aisles.map((a) => a.id)).toEqual(['aisle-1']);
    expect(
      get(canonItems)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(get(aisles).map((a) => a.id)).toEqual(['aisle-1']);
    expect(__getSyncPending().initialSync).toBe(false);
  });

  it('warm start with cursors only requests the delta', async () => {
    const h = setupHarness();
    // Pre-existing local state.
    h.canonStore._items.set('a', makeItem('a', 1));
    await h.canonStore.setCursor('items', 1);
    await h.aisleStore.save([makeAisle('a1', 'Produce', 0)], 5);

    // Remote has one new item past the cursor.
    h.canonTransport._remote.set('a', makeItem('a', 1));
    h.canonTransport._remote.set('b', makeItem('b', 3));

    const pullSpy = vi.spyOn(h.canonTransport, 'pull');
    const aislePullSpy = vi.spyOn(h.aisleTransport, 'pull');

    cleanup = initCanonSync();
    await flush();

    expect(pullSpy).toHaveBeenCalledWith(1);
    expect(aislePullSpy).toHaveBeenCalledWith(5);
    expect(h.canonStore._items.has('b')).toBe(true);
    expect(h.canonStore._cursors.get('items')).toBe(3);
    // Aisles unchanged: remote revision <= local cursor -> null.
    expect(h.aisleStore._data?.revision).toBe(5);
  });

  it('manifest tick advancing only items skips aisles pull', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    const itemsPullSpy = vi.spyOn(h.canonTransport, 'pull');
    const aislePullSpy = vi.spyOn(h.aisleTransport, 'pull');

    // Establish baseline cursors so the tick comparison works deterministically.
    await h.canonStore.setCursor('items', 5);
    await h.aisleStore.save([], 10);
    h.canonTransport._remote.set('x', makeItem('x', 7));

    h.manifest.emit({ itemsRevision: 7, aislesRevision: 10 });
    await flush();

    expect(itemsPullSpy).toHaveBeenCalledWith(5);
    expect(aislePullSpy).not.toHaveBeenCalled();
    expect(h.canonStore._cursors.get('items')).toBe(7);
  });

  it('manifest tick advancing only aisles skips items pull', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    const itemsPullSpy = vi.spyOn(h.canonTransport, 'pull');
    const aislePullSpy = vi.spyOn(h.aisleTransport, 'pull');

    await h.canonStore.setCursor('items', 7);
    await h.aisleStore.save([], 10);
    h.aisleTransport._doc = { aisles: [makeAisle('a1', 'Produce', 0)], revision: 12 };

    h.manifest.emit({ itemsRevision: 7, aislesRevision: 12 });
    await flush();

    expect(aislePullSpy).toHaveBeenCalledWith(10);
    expect(itemsPullSpy).not.toHaveBeenCalled();
    expect(h.aisleStore._data?.revision).toBe(12);
  });

  it('sets manifestRefresh during a tick and clears it afterwards', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    const seenStates: boolean[] = [];
    const unsub = syncPending.subscribe((p) => seenStates.push(p.manifestRefresh));

    await h.canonStore.setCursor('items', 0);
    await h.aisleStore.save([], 0);
    h.canonTransport._remote.set('x', makeItem('x', 1));

    h.manifest.emit({ itemsRevision: 1, aislesRevision: 0 });
    await flush();
    unsub();

    expect(seenStates).toContain(true);
    expect(__getSyncPending().manifestRefresh).toBe(false);
  });

  it('drains items pending queue on cold start', async () => {
    const h = setupHarness();
    const queued = makeItem('queued', 0);
    await h.canonStore.enqueuePendingWrite(queued);

    cleanup = initCanonSync();
    await flush();

    expect(h.canonTransport._remote.has('queued')).toBe(true);
    expect(h.canonStore._pending.size).toBe(0);
  });

  it('routes items push conflicts to canonConflicts and resolves them', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    // Local thinks revision 1, remote is at revision 5.
    const local = makeItem('a', 1, { name: 'local' });
    const remote = makeItem('a', 5, { name: 'remote' });
    h.canonTransport._remote.set('a', remote);
    await h.canonStore.enqueuePendingWrite(local);

    await __drainQueuesForTest();
    await flush();

    expect(get(canonConflicts).length).toBe(1);
    const c = get(canonConflicts)[0]!;
    expect(c.local.name).toBe('local');
    expect(c.remote.name).toBe('remote');

    await resolveConflict(c, 'keep-local');
    await flush();
    await __drainQueuesForTest();
    await flush();
    expect(get(canonConflicts).length).toBe(0);
    // After resolve: a new push went out; remote got bumped past 5.
    expect(h.canonTransport._remote.get('a')!.revision).toBeGreaterThan(5);
  });

  it('routes aisles push conflicts to aisleConflicts and resolves them', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    // Local at rev 0; remote at rev 3 with different content.
    h.aisleTransport._doc = { aisles: [makeAisle('remote', 'Remote', 0)], revision: 3 };
    await h.aisleStore.save([makeAisle('local', 'Local', 0)], 0);
    await h.aisleStore.enqueuePendingSave([makeAisle('local', 'Local', 0)]);

    await __drainQueuesForTest();
    await flush();

    expect(get(aisleConflicts).length).toBe(1);
    const c: Conflict<AislesDocument> = get(aisleConflicts)[0]!;
    expect(c.local.aisles.map((a) => a.id)).toEqual(['local']);
    expect(c.remote.aisles.map((a) => a.id)).toEqual(['remote']);

    await resolveAisleConflict(c, 'keepRemote');
    await flush();
    expect(get(aisleConflicts).length).toBe(0);
    expect(h.aisleStore._data?.aisles.map((a) => a.id)).toEqual(['remote']);
  });

  it('re-enqueues items push on transport failure and drains them on retry', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    h.canonTransport._failNextPush = true;
    await h.canonStore.enqueuePendingWrite(makeItem('a', 0));
    await __drainQueuesForTest();
    await flush();

    expect(h.canonTransport._remote.has('a')).toBe(false);
    expect(h.canonStore._pending.has('a')).toBe(true);

    await __drainQueuesForTest();
    await flush();
    expect(h.canonTransport._remote.has('a')).toBe(true);
  });

  it('triggers drain when window emits online', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    h.canonTransport._failNextPush = true;
    await h.canonStore.enqueuePendingWrite(makeItem('a', 0));
    await __drainQueuesForTest();
    await flush();
    expect(h.canonStore._pending.has('a')).toBe(true);

    window.dispatchEvent(new Event('online'));
    await flush();
    expect(h.canonTransport._remote.has('a')).toBe(true);
  });

  it('emits syncTick diagnostics for both scopes on cold start', async () => {
    const h = setupHarness();
    h.canonTransport._remote.set('x', makeItem('x', 1));
    h.aisleTransport._doc = { aisles: [], revision: 1 };

    cleanup = initCanonSync();
    await flush();

    const scopes = h.diagnostics.events.map((e) => e.scope).sort();
    expect(scopes).toEqual(['aisles', 'items']);
  });

  it('reports sync errors via ErrorReportingPort', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'NetworkError', reason: 'offline' };

    cleanup = initCanonSync();
    await flush();

    expect(h.errors.errors.length).toBeGreaterThan(0);
  });

  it('enqueueAisleSave drains a successful push end-to-end', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    await h.aisleStore.save([makeAisle('a1', 'Produce', 0)], 0);
    await enqueueAisleSave();
    await flush();

    expect(h.aisleTransport._doc?.aisles.map((a) => a.id)).toEqual(['a1']);
    expect(h.aisleStore._pending).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Phase 6 §1 — DomainError category coverage audit
//
// Each non-conflict DomainError category must be observed flowing through
// `ErrorReportingPort` from at least one canon-sync code path. Some adapters
// never naturally emit certain categories (e.g. firebase-sync's classifier
// has no SyncError or ValidationError branch), so those are stub-tested by
// injecting a fake transport that returns the relevant DomainError.
// Conflict is excluded — it is a domain event, not an error (Phase 5 flag #2).
// ───────────────────────────────────────────────────────────────────────────────

describe('canonService — DomainError category coverage (§7.6 audit)', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    __resetCanonServiceForTest();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    __setCanonServiceDeps(null);
    __resetCanonServiceForTest();
  });

  it('AuthError flows through ErrorReportingPort on items pull failure', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'AuthError', reason: 'forbidden' };
    cleanup = initCanonSync();
    await flush();

    expect(h.errors.errors).toContainEqual({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('NetworkError flows through ErrorReportingPort on items pull failure', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'NetworkError', reason: 'transient' };
    cleanup = initCanonSync();
    await flush();

    expect(h.errors.errors).toContainEqual({ kind: 'NetworkError', reason: 'transient' });
  });

  it('StorageError flows through ErrorReportingPort on items pull failure', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'StorageError', reason: 'quota-exceeded' };
    cleanup = initCanonSync();
    await flush();

    expect(h.errors.errors).toContainEqual({ kind: 'StorageError', reason: 'quota-exceeded' });
  });

  // Stub coverage: SyncError is part of the closed-set but no current adapter
  // path classifies into it. If a future adapter emits SyncError (e.g. on
  // manifest-revision mismatch), this test guarantees it propagates to LD.
  it('SyncError flows through ErrorReportingPort when an adapter emits it (stub)', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'SyncError', reason: 'manifest-mismatch' };
    cleanup = initCanonSync();
    await flush();

    expect(h.errors.errors).toContainEqual({ kind: 'SyncError', reason: 'manifest-mismatch' });
  });

  // Stub coverage: ValidationError originates in domain commands, not in
  // sync transports. This test injects a ValidationError into the manifest
  // error channel to assert the reporter forwards it intact.
  it('ValidationError flows through ErrorReportingPort via manifest onError (stub)', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    h.manifest.emitError({
      kind: 'ValidationError',
      code: 'INVALID_CANON_NAME',
      message: 'reserved for stub test',
    });

    expect(h.errors.errors).toContainEqual({
      kind: 'ValidationError',
      code: 'INVALID_CANON_NAME',
      message: 'reserved for stub test',
    });
  });

  it('aisles pull failures flow through the same reporter (per-scope coverage)', async () => {
    const h = setupHarness();
    // Force the aisle transport to fail without touching items.
    const orig = h.aisleTransport.pull.bind(h.aisleTransport);
    h.aisleTransport.pull = async () =>
      failure({ kind: 'NetworkError', reason: 'offline' } satisfies DomainError);
    cleanup = initCanonSync();
    await flush();
    h.aisleTransport.pull = orig;

    expect(h.errors.errors).toContainEqual({ kind: 'NetworkError', reason: 'offline' });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Phase 6 §2 — syncHealth derived store
// ───────────────────────────────────────────────────────────────────────────────

describe('canonService — syncHealth store', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    __resetCanonServiceForTest();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    __setCanonServiceDeps(null);
    __resetCanonServiceForTest();
  });

  it('starts with all fields null', () => {
    setupHarness();
    expect(get(syncHealth)).toEqual({
      itemsCursor: null,
      aislesCursor: null,
      lastTickAt: null,
      lastError: null,
    });
  });

  it('records itemsCursor and lastTickAt after a successful items pull', async () => {
    const h = setupHarness();
    h.canonTransport._remote.set('a', makeItem('a', 7));
    cleanup = initCanonSync();
    await flush();

    const health = get(syncHealth);
    expect(health.itemsCursor).toBe(7);
    expect(health.lastTickAt).not.toBeNull();
  });

  it('records aislesCursor after a successful aisles pull', async () => {
    const h = setupHarness();
    h.aisleTransport._doc = { aisles: [makeAisle('a1', 'Produce', 0)], revision: 4 };
    cleanup = initCanonSync();
    await flush();

    expect(get(syncHealth).aislesCursor).toBe(4);
  });

  it('records lastError when a pull returns a DomainError', async () => {
    const h = setupHarness();
    h.canonTransport._pullErr = { kind: 'AuthError', reason: 'forbidden' };
    cleanup = initCanonSync();
    await flush();

    expect(get(syncHealth).lastError).toEqual({ kind: 'AuthError', reason: 'forbidden' });
  });

  it('updates cursors independently per scope on subsequent ticks', async () => {
    const h = setupHarness();
    cleanup = initCanonSync();
    await flush();

    // Items advance via tick.
    h.canonTransport._remote.set('a', makeItem('a', 3));
    h.manifest.emit({ itemsRevision: 3, aislesRevision: 0 });
    await flush();
    expect(get(syncHealth).itemsCursor).toBe(3);
    expect(get(syncHealth).aislesCursor).toBe(0);

    // Aisles advance via a later tick — items unchanged.
    h.aisleTransport._doc = { aisles: [makeAisle('a1', 'Produce', 0)], revision: 9 };
    h.manifest.emit({ itemsRevision: 3, aislesRevision: 9 });
    await flush();
    expect(get(syncHealth).itemsCursor).toBe(3);
    expect(get(syncHealth).aislesCursor).toBe(9);
  });
});
