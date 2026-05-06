import {
  subscribeCanonItems,
  upsertCanonItem,
  subscribeAisles,
  createGeminiEmbeddingAdapter,
  createGeminiArbitrationAdapter,
} from '@salt/firebase-sync';
import {
  createLDMatchLoggingAdapter,
  createLDErrorReportingAdapter,
  startSpan,
} from '@salt/ld-observability';
import type { ObservabilitySpan } from '@salt/ld-observability';
import type { CanonArbitrationPort, EmbeddingPort } from '@salt/domain';
import {
  approveCanonItem,
  matchOrCreate,
  renameCanonItem,
  setCanonItemAisle,
  setCanonItemSynonyms,
  setCanonItemShoppingBehavior,
  setCanonItemThreshold,
} from '@salt/domain';
import type {
  Aisle,
  ApproveCanonItemOverrides,
  CanonItem,
  CanonItemUnit,
  CanonLocalStorePort,
  AisleLocalStorePort,
  MatchOrCreateResult,
  ShoppingBehavior,
} from '@salt/domain';
import { failure } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

export type { MatchOrCreateResult };

// ─── Reactive stores ────────────────────────────────────────────────────────────

const _canonItems = writable<readonly CanonItem[]>([]);
export const canonItems: Readable<readonly CanonItem[]> = _canonItems;

const _aisles = writable<readonly Aisle[]>([]);
export const aisles: Readable<readonly Aisle[]> = _aisles;

const _aisleUsage = writable<Map<string, number>>(new Map());
export const aisleUsage: Readable<Map<string, number>> = _aisleUsage;

const _isLoadingAisles = writable(false);
export const isLoadingAisles: Readable<boolean> = _isLoadingAisles;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createLDErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createLDErrorReportingAdapter();
  return _errorReporter;
}

// ─── Internal loading state ─────────────────────────────────────────────────────

let _receivedItems = false;
let _receivedAisles = false;

function markLoaded(scope: 'items' | 'aisles'): void {
  if (scope === 'items') _receivedItems = true;
  if (scope === 'aisles') _receivedAisles = true;
  if (_receivedItems && _receivedAisles) _isLoadingAisles.set(false);
}

// ─── Aisle usage ─────────────────────────────────────────────────────────────────

function recomputeAisleUsage(): void {
  const items = get(_canonItems);
  const currentAisles = get(_aisles);
  const usage = new Map<string, number>(currentAisles.map((a) => [a.id, 0]));
  for (const item of items) {
    if (item.aisleId !== null && usage.has(item.aisleId)) {
      usage.set(item.aisleId, (usage.get(item.aisleId) ?? 0) + 1);
    }
  }
  _aisleUsage.set(usage);
}

// ─── In-memory store adapters (for domain commands) ─────────────────────────────

export function memAisleStore(seed: readonly Aisle[]) {
  let written: readonly Aisle[] | null = null;
  const store: AisleLocalStorePort = {
    async load() {
      return { kind: 'ok', value: { aisles: written ?? seed, revision: 0 } };
    },
    async save(aisles, _revision) {
      written = aisles;
      return { kind: 'ok', value: undefined };
    },
    async enqueuePendingSave() {
      return { kind: 'ok', value: undefined };
    },
    async drainPendingSave() {
      return { kind: 'ok', value: null };
    },
  };
  return { store, getWritten: () => written };
}

export function memCanonStore(seed: readonly CanonItem[]) {
  const items = new Map(seed.map((i) => [i.id, i]));
  const upserted: CanonItem[] = [];
  const store: CanonLocalStorePort = {
    async upsert(item) {
      items.set(item.id, item);
      upserted.push(item);
      return { kind: 'ok', value: item };
    },
    async load(id) {
      return { kind: 'ok', value: items.get(id) ?? null };
    },
    async list() {
      return { kind: 'ok', value: [...items.values()].filter((i) => i.deletedAt === null) };
    },
    async delete(id) {
      items.delete(id);
      return { kind: 'ok', value: undefined };
    },
    async getCursor() {
      return { kind: 'ok', value: null };
    },
    async setCursor() {
      return { kind: 'ok', value: undefined };
    },
    async enqueuePendingWrite() {
      return { kind: 'ok', value: undefined };
    },
    async drainPendingWrites() {
      return { kind: 'ok', value: [] };
    },
  };
  return { store, getUpserted: () => [...upserted] };
}

// ─── Snapshots (used by aisleService) ───────────────────────────────────────────

export function getAislesSnapshot(): readonly Aisle[] {
  return get(_aisles);
}

export function getCanonItemsSnapshot(): readonly CanonItem[] {
  return get(_canonItems);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

export function initCanonSync(): () => void {
  _isLoadingAisles.set(true);
  _receivedItems = false;
  _receivedAisles = false;

  const errors = getErrorReporter();

  const unsubItems = subscribeCanonItems(
    (items) => {
      _canonItems.set(items.filter((i) => i.deletedAt === null));
      recomputeAisleUsage();
      markLoaded('items');
    },
    (err) => errors.report(err),
  );

  const unsubAisles = subscribeAisles(
    (newAisles) => {
      _aisles.set([...newAisles].sort((a, b) => a.order - b.order));
      recomputeAisleUsage();
      markLoaded('aisles');
    },
    (err) => errors.report(err),
  );

  return () => {
    unsubItems();
    unsubAisles();
  };
}

// ─── Traced arbitration adapter ──────────────────────────────────────────────────

function createTracedEmbeddingAdapter(
  inner: EmbeddingPort,
  parentSpan?: ObservabilitySpan,
): EmbeddingPort {
  return {
    async computeEmbedding(text) {
      const span = startSpan(
        `canon.embed: ${text}`,
        parentSpan ? { parent: parentSpan } : undefined,
      );
      try {
        return await inner.computeEmbedding(text);
      } finally {
        span.end();
      }
    },
    cosineSimilarity(a, b) {
      return inner.cosineSimilarity(a, b);
    },
  };
}

function createTracedArbitrationAdapter(
  inner: CanonArbitrationPort,
  parentSpan?: ObservabilitySpan,
): CanonArbitrationPort {
  return {
    async arbitrate(req) {
      const span = startSpan(
        `canon.arbitrate: ${req.normalisedName}`,
        parentSpan ? { parent: parentSpan } : undefined,
      );
      span.setAttribute('arbitration.ingredient', req.normalisedName);
      span.setAttribute('arbitration.aisle_count', req.aisles.length);
      try {
        const result = await inner.arbitrate(req);
        if (result.kind === 'ok') {
          const r = result.value;
          if (r.kind === 'match') {
            span.setAttribute('arbitration.outcome', 'match');
            span.setAttribute(
              'arbitration.confidence',
              parseFloat((r.confidence * 100).toFixed(1)),
            );
          } else if (r.kind === 'new') {
            span.setAttribute('arbitration.outcome', 'new');
            const aisle = req.aisles.find((a) => a.id === r.aisleId);
            span.setAttribute('arbitration.suggested_aisle', aisle?.name ?? 'none');
          } else {
            span.setAttribute('arbitration.outcome', 'no-match');
          }
        } else {
          span.setAttribute('arbitration.outcome', 'error');
          span.setAttribute('arbitration.error', result.error.kind);
        }
        return result;
      } finally {
        span.end();
      }
    },
  };
}

// ─── Canon item commands ─────────────────────────────────────────────────────────

export async function addCanonItem(
  rawName: string,
  selectedAisleId?: string | null,
  forceCreate?: boolean,
): Promise<Result<MatchOrCreateResult, DomainError>> {
  const span = startSpan(`canon.add: ${rawName}`);
  const errors = getErrorReporter();
  try {
    const { store: canonStore } = memCanonStore(get(_canonItems));
    const { store: aisleStore } = memAisleStore(get(_aisles));
    const result = await matchOrCreate(
      { rawName, selectedAisleId, ...(forceCreate !== undefined && { forceCreate }) },
      {
        store: canonStore,
        aisleStore,
        embedding: createTracedEmbeddingAdapter(createGeminiEmbeddingAdapter(errors), span),
        arbitration: createTracedArbitrationAdapter(createGeminiArbitrationAdapter(errors), span),
        ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
        logging: createLDMatchLoggingAdapter(span),
      },
    );
    if (result.kind === 'ok') {
      span.setAttribute('canon.outcome', result.value.decision);
      span.setAttribute('canon.result', result.value.item.name);
      try {
        await upsertCanonItem(result.value.item);
      } catch (err) {
        errors.report(err);
        span.setAttribute('canon.error', 'StorageError');
        return failure({ kind: 'StorageError', reason: 'unavailable' });
      }
    } else {
      span.setAttribute('canon.error', result.error.kind);
    }
    return result;
  } finally {
    span.end();
  }
}

async function commitCanonItemUpdate(item: CanonItem): Promise<void> {
  await upsertCanonItem(item);
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

export async function updateCanonItemShoppingBehavior(
  item: CanonItem,
  shoppingBehavior: ShoppingBehavior,
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemShoppingBehavior(item, shoppingBehavior);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function updateCanonItemThreshold(
  item: CanonItem,
  largeQuantityThreshold: number | undefined,
  unit: CanonItemUnit | undefined,
): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemThreshold(item, largeQuantityThreshold, unit);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function approveCanonItemWithOverrides(
  item: CanonItem,
  overrides?: ApproveCanonItemOverrides,
): Promise<Result<CanonItem, DomainError>> {
  const result = approveCanonItem(item, overrides);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

export async function approveCanonItems(ids: string[]): Promise<void> {
  const items = get(_canonItems);
  await Promise.all(
    ids.map((id) => {
      const item = items.find((i) => i.id === id);
      if (!item) return Promise.resolve();
      const result = approveCanonItem(item);
      if (result.kind === 'ok') return commitCanonItemUpdate(result.value);
      return Promise.resolve();
    }),
  );
}

export async function deleteCanonItem(id: string): Promise<Result<void, DomainError>> {
  const item = get(_canonItems).find((i) => i.id === id) ?? null;
  if (item !== null) {
    const tombstone: CanonItem = { ...item, deletedAt: new Date().toISOString() };
    await upsertCanonItem(tombstone);
  }
  return { kind: 'ok', value: undefined };
}

// ─── Test helpers ────────────────────────────────────────────────────────────────

export function __resetCanonServiceForTest(): void {
  _canonItems.set([]);
  _aisles.set([]);
  _aisleUsage.set(new Map());
  _isLoadingAisles.set(false);
  _receivedItems = false;
  _receivedAisles = false;
  _errorReporter = null;
}
