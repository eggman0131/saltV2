import {
  createFirebaseCanonSyncTransportAdapter,
  createFirebaseAisleSyncTransportAdapter,
  createFirebaseManifestListener,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
} from '@salt/firebase-sync';
import {
  createLDMatchLoggingAdapter,
  createLDErrorReportingAdapter,
  createLDSyncDiagnosticsAdapter,
} from '@salt/ld-observability';
import {
  matchOrCreate,
  resolveCanonConflict,
  renameCanonItem,
  setCanonItemAisle,
  setCanonItemSynonyms,
  listAisles,
  getAisleUsage,
} from '@salt/domain';
import type {
  Aisle,
  AislesDocument,
  AisleLocalStorePort,
  AisleSyncTransportPort,
  CanonItem,
  CanonLocalStorePort,
  CanonSyncTransportPort,
  ConflictStrategy,
  ErrorReportingPort,
  ManifestTick,
  MatchOrCreateResult,
  SyncDiagnosticsPort,
  SyncPending,
} from '@salt/domain';
import type { Conflict, DomainError, Result } from '@salt/shared-types';
import { createLocalCanonStoreAdapter, createLocalAisleStoreAdapter } from '@salt/local-store';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

export type { MatchOrCreateResult };

// ─── Singletons ────────────────────────────────────────────────────────────────

let _localCanonStore: CanonLocalStorePort | null = null;
let _localAisleStore: AisleLocalStorePort | null = null;
let _canonTransport: CanonSyncTransportPort | null = null;
let _aisleTransport: AisleSyncTransportPort | null = null;
let _errorReporter: ErrorReportingPort | null = null;
let _diagnostics: SyncDiagnosticsPort | null = null;

export function getLocalCanonStore(): CanonLocalStorePort {
  if (!_localCanonStore) _localCanonStore = createLocalCanonStoreAdapter();
  return _localCanonStore;
}

export function getLocalAisleStore(): AisleLocalStorePort {
  if (!_localAisleStore) _localAisleStore = createLocalAisleStoreAdapter();
  return _localAisleStore;
}

function getErrorReporter(): ErrorReportingPort {
  if (!_errorReporter) _errorReporter = createLDErrorReportingAdapter();
  return _errorReporter;
}

function getDiagnostics(): SyncDiagnosticsPort {
  if (!_diagnostics) _diagnostics = createLDSyncDiagnosticsAdapter();
  return _diagnostics;
}

function getCanonTransport(): CanonSyncTransportPort {
  if (!_canonTransport)
    _canonTransport = createFirebaseCanonSyncTransportAdapter(getErrorReporter());
  return _canonTransport;
}

function getAisleTransport(): AisleSyncTransportPort {
  if (!_aisleTransport)
    _aisleTransport = createFirebaseAisleSyncTransportAdapter(getErrorReporter());
  return _aisleTransport;
}

/** Test seam: replace adapter singletons. Tests only. */
export interface CanonServiceDeps {
  readonly localCanonStore: CanonLocalStorePort;
  readonly localAisleStore: AisleLocalStorePort;
  readonly canonTransport: CanonSyncTransportPort;
  readonly aisleTransport: AisleSyncTransportPort;
  readonly errors: ErrorReportingPort;
  readonly diagnostics: SyncDiagnosticsPort;
  readonly subscribeManifest: (
    onTick: (tick: ManifestTick) => void,
    onError: (err: DomainError) => void,
  ) => () => void;
  readonly now: () => number;
}

let _deps: CanonServiceDeps | null = null;

export function __setCanonServiceDeps(deps: CanonServiceDeps | null): void {
  _deps = deps;
}

function deps(): CanonServiceDeps {
  if (_deps) return _deps;
  return {
    localCanonStore: getLocalCanonStore(),
    localAisleStore: getLocalAisleStore(),
    canonTransport: getCanonTransport(),
    aisleTransport: getAisleTransport(),
    errors: getErrorReporter(),
    diagnostics: getDiagnostics(),
    subscribeManifest: (onTick, onError) => createFirebaseManifestListener(onTick, onError),
    now: () => Date.now(),
  };
}

// ─── Reactive stores ───────────────────────────────────────────────────────────

const _canonItems = writable<readonly CanonItem[]>([]);
export const canonItems: Readable<readonly CanonItem[]> = _canonItems;

const _aisles = writable<readonly Aisle[]>([]);
export const aisles: Readable<readonly Aisle[]> = _aisles;

const _aisleUsage = writable<Map<string, number>>(new Map());
export const aisleUsage: Readable<Map<string, number>> = _aisleUsage;

const _syncPending = writable<SyncPending>({
  initialSync: false,
  pull: false,
  push: false,
  manifestRefresh: false,
});
export const syncPending: Readable<SyncPending> = _syncPending;

const _isLoadingAisles = writable(false);
export const isLoadingAisles: Readable<boolean> = _isLoadingAisles;

const _canonConflicts = writable<Conflict<CanonItem>[]>([]);
export const canonConflicts: Readable<Conflict<CanonItem>[]> = _canonConflicts;

const _aisleConflicts = writable<Conflict<AislesDocument>[]>([]);
export const aisleConflicts: Readable<Conflict<AislesDocument>[]> = _aisleConflicts;

function setPending(patch: Partial<SyncPending>): void {
  _syncPending.update((p) => ({ ...p, ...patch }));
}

// ─── Refreshers ────────────────────────────────────────────────────────────────

export async function refreshCanonItems(): Promise<void> {
  const result = await deps().localCanonStore.list();
  if (result.kind === 'ok') _canonItems.set([...result.value]);
}

export async function refreshAisles(): Promise<void> {
  const [aislesResult, usageResult] = await Promise.all([
    listAisles(deps().localAisleStore),
    getAisleUsage(deps().localAisleStore, deps().localCanonStore),
  ]);
  if (aislesResult.kind === 'ok') _aisles.set([...aislesResult.value]);
  if (usageResult.kind === 'ok') _aisleUsage.set(new Map(usageResult.value));
}

// ─── Pull replay ───────────────────────────────────────────────────────────────

async function applyItemsBatch(items: readonly CanonItem[]): Promise<void> {
  const store = deps().localCanonStore;
  for (const item of items) {
    // Tombstones (deletedAt != null) flow through upsert; localCanonStore.list() filters them.
    await store.upsert(item);
  }
}

async function applyAislesBatch(payload: {
  readonly aisles: readonly Aisle[];
  readonly cursor: number;
}): Promise<void> {
  await deps().localAisleStore.save(payload.aisles, payload.cursor);
}

async function pullItems(scopeStartedAt: number): Promise<void> {
  const d = deps();
  const cursorRes = await d.localCanonStore.getCursor('items');
  if (cursorRes.kind === 'err') {
    d.errors.report(cursorRes.error);
    return;
  }
  const pullRes = await d.canonTransport.pull(cursorRes.value);
  if (pullRes.kind === 'err') {
    d.errors.report(pullRes.error);
    return;
  }
  await applyItemsBatch(pullRes.value.upserted);
  await d.localCanonStore.setCursor('items', pullRes.value.cursor);
  await refreshCanonItems();
  d.diagnostics.syncTick({
    scope: 'items',
    cursor: pullRes.value.cursor,
    batchSize: pullRes.value.upserted.length,
    durationMs: d.now() - scopeStartedAt,
  });
}

async function pullAisles(scopeStartedAt: number): Promise<void> {
  const d = deps();
  const cursorRes = await d.localAisleStore.load();
  const sinceCursor = cursorRes.kind === 'ok' ? (cursorRes.value?.revision ?? null) : null;
  const pullRes = await d.aisleTransport.pull(sinceCursor);
  if (pullRes.kind === 'err') {
    d.errors.report(pullRes.error);
    return;
  }
  if (pullRes.value === null) {
    d.diagnostics.syncTick({
      scope: 'aisles',
      cursor: sinceCursor ?? 0,
      batchSize: 0,
      durationMs: d.now() - scopeStartedAt,
    });
    return;
  }
  await applyAislesBatch(pullRes.value);
  // Mirror revision into the canon-store cursor for cross-scope visibility.
  await d.localCanonStore.setCursor('aisles', pullRes.value.cursor);
  await refreshAisles();
  d.diagnostics.syncTick({
    scope: 'aisles',
    cursor: pullRes.value.cursor,
    batchSize: pullRes.value.aisles.length,
    durationMs: d.now() - scopeStartedAt,
  });
}

// ─── Push drains ───────────────────────────────────────────────────────────────

let _itemsDrainInFlight = false;
let _aislesDrainInFlight = false;

async function drainItemsQueue(): Promise<void> {
  if (_itemsDrainInFlight) return;
  _itemsDrainInFlight = true;
  const d = deps();
  try {
    const drained = await d.localCanonStore.drainPendingWrites();
    if (drained.kind === 'err') {
      d.errors.report(drained.error);
      return;
    }
    if (drained.value.length === 0) return;
    setPending({ push: true });
    for (const item of drained.value) {
      const r = await d.canonTransport.push(item);
      if (r.kind === 'conflict') {
        _canonConflicts.update((cs) => [...cs, r]);
      } else if (r.kind === 'err') {
        // Push failed — re-enqueue so a future drain retries.
        await d.localCanonStore.enqueuePendingWrite(item);
        d.errors.report(r.error);
      }
    }
  } finally {
    setPending({ push: false });
    _itemsDrainInFlight = false;
  }
}

async function drainAislesQueue(): Promise<void> {
  if (_aislesDrainInFlight) return;
  _aislesDrainInFlight = true;
  const d = deps();
  try {
    const drained = await d.localAisleStore.drainPendingSave();
    if (drained.kind === 'err') {
      d.errors.report(drained.error);
      return;
    }
    if (drained.value === null) return;
    const local = await d.localAisleStore.load();
    const baseRevision = local.kind === 'ok' ? (local.value?.revision ?? 0) : 0;
    setPending({ push: true });
    const r = await d.aisleTransport.push(drained.value, baseRevision);
    if (r.kind === 'conflict') {
      _aisleConflicts.update((cs) => [...cs, r]);
    } else if (r.kind === 'err') {
      // Push failed — re-enqueue depth-1 so a future drain retries.
      await d.localAisleStore.enqueuePendingSave(drained.value);
      d.errors.report(r.error);
    }
  } finally {
    setPending({ push: false });
    _aislesDrainInFlight = false;
  }
}

// ─── Manifest tick handler ─────────────────────────────────────────────────────

let _lastTickPromise: Promise<void> | null = null;

async function handleManifestTick(tick: ManifestTick): Promise<void> {
  const d = deps();
  const [itemsCursorRes, aislesLocal] = await Promise.all([
    d.localCanonStore.getCursor('items'),
    d.localAisleStore.load(),
  ]);
  const itemsCursor = itemsCursorRes.kind === 'ok' ? (itemsCursorRes.value ?? 0) : 0;
  const aislesCursor = aislesLocal.kind === 'ok' ? (aislesLocal.value?.revision ?? 0) : 0;

  const itemsAdvanced = tick.itemsRevision > itemsCursor;
  const aislesAdvanced = tick.aislesRevision > aislesCursor;
  if (!itemsAdvanced && !aislesAdvanced) return;

  setPending({ manifestRefresh: true });
  try {
    const tasks: Promise<void>[] = [];
    const tickStart = d.now();
    if (itemsAdvanced) tasks.push(pullItems(tickStart).then(() => drainItemsQueue()));
    if (aislesAdvanced) tasks.push(pullAisles(tickStart).then(() => drainAislesQueue()));
    await Promise.all(tasks);
  } finally {
    setPending({ manifestRefresh: false });
  }
}

// ─── Init / cleanup ────────────────────────────────────────────────────────────

let _onlineHandler: (() => void) | null = null;
let _initReady: Promise<void> | null = null;

export function initCanonSync(): () => void {
  setPending({ initialSync: true });
  _isLoadingAisles.set(true);

  const d = deps();
  const cleanups: Array<() => void> = [];

  // Cold start: refresh from local first so UI lights up offline-first,
  // then run both pulls in parallel, then drain pending queues.
  _initReady = (async () => {
    try {
      await Promise.all([refreshCanonItems(), refreshAisles()]);
      const tickStart = d.now();
      await Promise.all([pullItems(tickStart), pullAisles(tickStart)]);
      setPending({ initialSync: false });
      _isLoadingAisles.set(false);
      await Promise.all([drainItemsQueue(), drainAislesQueue()]);
    } catch (err) {
      setPending({ initialSync: false });
      _isLoadingAisles.set(false);
      d.errors.report(err);
    }
  })();

  const unsubscribeManifest = d.subscribeManifest(
    (tick) => {
      _lastTickPromise = handleManifestTick(tick).catch((err) => d.errors.report(err));
    },
    (err) => d.errors.report(err),
  );
  cleanups.push(unsubscribeManifest);

  if (typeof window !== 'undefined') {
    _onlineHandler = () => {
      void Promise.all([drainItemsQueue(), drainAislesQueue()]).catch((err) =>
        d.errors.report(err),
      );
    };
    window.addEventListener('online', _onlineHandler);
    cleanups.push(() => {
      if (_onlineHandler) window.removeEventListener('online', _onlineHandler);
      _onlineHandler = null;
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

// ─── Canon item commands ───────────────────────────────────────────────────────

export async function addCanonItem(
  rawName: string,
  selectedAisleId?: string | null,
  forceCreate?: boolean,
): Promise<Result<MatchOrCreateResult, DomainError>> {
  const d = deps();
  const result = await matchOrCreate(
    { rawName, selectedAisleId, ...(forceCreate !== undefined && { forceCreate }) },
    {
      store: d.localCanonStore,
      aisleStore: d.localAisleStore,
      embedding: createGeminiEmbeddingAdapter(d.errors),
      arbitration: createGeminiArbitrationAdapter(d.errors),
      ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
      logging: createLDMatchLoggingAdapter(),
    },
  );
  if (result.kind === 'ok') {
    await d.localCanonStore.enqueuePendingWrite(result.value.item);
    await refreshCanonItems();
    void drainItemsQueue();
  }
  return result;
}

async function commitCanonItemUpdate(item: CanonItem): Promise<void> {
  const d = deps();
  await d.localCanonStore.upsert(item);
  await d.localCanonStore.enqueuePendingWrite(item);
  await refreshCanonItems();
  void drainItemsQueue();
}

export async function updateCanonItemName(
  item: CanonItem,
  newName: string,
): Promise<Result<CanonItem, DomainError>> {
  const result = renameCanonItem(item, newName);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function updateCanonItemAisle(
  item: CanonItem,
  aisleId: string | null,
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemAisle(item, aisleId);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function updateCanonItemSynonyms(
  item: CanonItem,
  synonyms: readonly string[],
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemSynonyms(item, synonyms);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function deleteCanonItem(id: string): Promise<Result<void, DomainError>> {
  const d = deps();
  const loaded = await d.localCanonStore.load(id);
  if (loaded.kind === 'err') return loaded;
  if (loaded.value !== null) {
    const tombstone: CanonItem = { ...loaded.value, deletedAt: new Date().toISOString() };
    await d.localCanonStore.upsert(tombstone);
    await d.localCanonStore.enqueuePendingWrite(tombstone);
  }
  await refreshCanonItems();
  void drainItemsQueue();
  return { kind: 'ok', value: undefined };
}

export async function resolveConflict(
  conflictItem: Conflict<CanonItem>,
  strategy: ConflictStrategy,
): Promise<void> {
  const d = deps();
  const resolved = resolveCanonConflict(strategy, conflictItem.local, conflictItem.remote);
  // Use the remote revision so the next push baseline matches Firestore.
  const reconciled: CanonItem = { ...resolved, revision: conflictItem.remote.revision };
  await d.localCanonStore.upsert(reconciled);
  await d.localCanonStore.enqueuePendingWrite(reconciled);
  _canonConflicts.update((cs) => cs.filter((c) => c.local.id !== conflictItem.local.id));
  await refreshCanonItems();
  void drainItemsQueue();
}

// ─── Aisle composition (used by aisleService facade) ───────────────────────────

/** Called by aisleService after a domain command writes new aisles to local store. */
export async function enqueueAisleSave(): Promise<void> {
  const d = deps();
  const local = await d.localAisleStore.load();
  if (local.kind !== 'ok' || local.value === null) return;
  await d.localAisleStore.enqueuePendingSave(local.value.aisles);
  await refreshAisles();
  void drainAislesQueue();
}

export async function resolveAisleConflict(
  conflictDoc: Conflict<AislesDocument>,
  strategy: 'keepLocal' | 'keepRemote',
): Promise<void> {
  const d = deps();
  const chosen = strategy === 'keepLocal' ? conflictDoc.local.aisles : conflictDoc.remote.aisles;
  const baseRevision = conflictDoc.remote.revision;
  await d.localAisleStore.save(chosen, baseRevision);
  await d.localCanonStore.setCursor('aisles', baseRevision);
  if (strategy === 'keepLocal') {
    await d.localAisleStore.enqueuePendingSave(chosen);
  }
  _aisleConflicts.update((cs) => cs.filter((c) => c !== conflictDoc));
  await refreshAisles();
  if (strategy === 'keepLocal') void drainAislesQueue();
}

/** Test-only: force-drain queues. */
export async function __drainQueuesForTest(): Promise<void> {
  await Promise.all([drainItemsQueue(), drainAislesQueue()]);
}

/** Test-only: synchronously read current state (for assertions). */
export function __getSyncPending(): SyncPending {
  return get(_syncPending);
}

/** Test-only: await the in-flight cold-start IIFE, if any. */
export async function __waitForInit(): Promise<void> {
  if (_initReady) await _initReady;
}

/** Test-only: await the most recent manifest tick handler, if any. */
export async function __waitForLastTick(): Promise<void> {
  if (_lastTickPromise) await _lastTickPromise;
}

/** Test-only: reset reactive stores and module state between tests. */
export function __resetCanonServiceForTest(): void {
  _canonItems.set([]);
  _aisles.set([]);
  _aisleUsage.set(new Map());
  _canonConflicts.set([]);
  _aisleConflicts.set([]);
  _syncPending.set({ initialSync: false, pull: false, push: false, manifestRefresh: false });
  _isLoadingAisles.set(false);
  _initReady = null;
  _lastTickPromise = null;
  _itemsDrainInFlight = false;
  _aislesDrainInFlight = false;
  if (_onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', _onlineHandler);
  }
  _onlineHandler = null;
}
