import {
  subscribeCanonItems,
  upsertCanonItem,
  deleteCanonItem as deleteCanonItemDoc,
  subscribeAisles,
  callMatchOrCreate,
  callRegenerateCanonIcon,
} from '@salt/firebase-sync';
import {
  createObservabilityErrorReportingAdapter,
  createObservabilityMatchLoggingAdapter,
  startSpan,
} from '@salt/observability';
import {
  approveCanonItem,
  appendCanonSynonym,
  createCanonItem,
  findClosestMatch,
  MatchLogBuilder,
  normaliseName,
  renameCanonItem,
  setCanonItemAisle,
  setCanonItemSynonyms,
  setCanonItemShoppingBehavior,
  setCanonItemThreshold,
  setCanonItemThumbnail,
  CANON_ICON_HIDDEN,
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
import { ErrorCode, failure, success, type DomainError, type Result } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { reportSubscriptionError } from './errorReporting.js';

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

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
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

// ─── In-memory store adapters ───────────────────────────────────────────────────
// Used by aisleService for delete/merge flows that still run in the client.
// The canon match/create path runs in the CF and no longer touches these.

export function memAisleStore(seed: readonly Aisle[]) {
  let written: readonly Aisle[] | null = null;
  const store: AisleLocalStorePort = {
    async load() {
      return { kind: 'ok', value: written ?? seed };
    },
    async save(aisles) {
      written = aisles;
      return { kind: 'ok', value: undefined };
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
      return { kind: 'ok', value: [...items.values()] };
    },
    async delete(id) {
      items.delete(id);
      return { kind: 'ok', value: undefined };
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
      _canonItems.set(items);
      recomputeAisleUsage();
      markLoaded('items');
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );

  const unsubAisles = subscribeAisles(
    (newAisles) => {
      _aisles.set([...newAisles].sort((a, b) => a.order - b.order));
      recomputeAisleUsage();
      markLoaded('aisles');
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );

  return () => {
    unsubItems();
    unsubAisles();
  };
}

// ─── Canon item commands ─────────────────────────────────────────────────────────

export async function addCanonItem(
  rawName: string,
  selectedAisleId?: string | null,
  forceCreate?: boolean,
): Promise<Result<MatchOrCreateResult, DomainError>> {
  const span = startSpan(`canon.add: ${rawName}`);
  try {
    // Fast-path: stages 1–4 against the in-memory canon. Only a clear 'match'
    // short-circuits — 'ambiguous' and 'none' must escalate to the CF, which
    // owns AI arbitration. forceCreate also bypasses (CF runs aisle arbitration).
    if (!forceCreate) {
      const localItems = get(_canonItems);
      const normalised = normaliseName(rawName);
      const logBuilder = new MatchLogBuilder();
      logBuilder.start(rawName, normalised);
      logBuilder.setInputItemCount(localItems.length);
      const local = findClosestMatch(localItems, rawName, logBuilder);
      if (local.kind === 'match') {
        const updated = appendCanonSynonym(local.candidate.item, rawName);
        if (updated !== local.candidate.item) await upsertCanonItem(updated);
        span.setAttribute('canon.outcome', 'matched');
        span.setAttribute('canon.path', 'fast');
        span.setAttribute('canon.result', updated.name);
        const entry = logBuilder.complete(crypto.randomUUID(), 'matched', updated.id, updated.name);
        void createObservabilityMatchLoggingAdapter('fast', span)
          .write(entry)
          .catch(() => {});
        return success({ decision: 'matched' as const, item: updated });
      }
    }
    // No browser→CF trace headers are sent. Server-side trace unification reads
    // the inbound W3C trace context off the request at the callable entrypoint
    // (see apps/cloud-functions/src/index.ts); browser→CF trace minting stays
    // deferred.
    const result = await callMatchOrCreate({
      rawName,
      selectedAisleId,
      ...(forceCreate !== undefined && { forceCreate }),
    });
    if (result.kind === 'ok') {
      span.setAttribute('canon.outcome', result.value.decision);
      span.setAttribute('canon.path', 'cf');
      span.setAttribute('canon.result', result.value.item.name);
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

export async function splitMostRecentSynonym(
  item: CanonItem,
): Promise<Result<CanonItem, DomainError>> {
  if (item.synonyms.length === 0) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
  }
  const synonym = item.synonyms[item.synonyms.length - 1]!;
  const created = createCanonItem(
    { name: synonym, needs_approval: true },
    { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
  );
  if (created.kind !== 'ok') return created;
  const trimmed: CanonItem = { ...item, synonyms: item.synonyms.slice(0, -1) };
  await upsertCanonItem(created.value);
  await upsertCanonItem(trimmed);
  return created;
}

export async function deleteCanonItem(id: string): Promise<Result<void, DomainError>> {
  return deleteCanonItemDoc(id);
}

// ─── Icon (Tier-1 pictogram) escape hatch (issue #148) ───────────────────────────

/**
 * Regenerate a canon item's icon: clears `thumbnail` server-side (auth'd
 * callable), re-firing the trigger so the icon branch regenerates. An optional
 * `hint` is a one-shot additive steer for the next generation.
 */
export async function regenerateCanonIcon(
  id: string,
  hint?: string,
): Promise<Result<void, DomainError>> {
  return callRegenerateCanonIcon(id, hint);
}

/** Hide a canon item's icon: sets `thumbnail` to the "hidden" sentinel so the
 *  trigger never regenerates it and the UI shows the bare tile. */
export async function hideCanonIcon(item: CanonItem): Promise<Result<CanonItem, DomainError>> {
  const result = setCanonItemThumbnail(item, CANON_ICON_HIDDEN);
  if (result.kind === 'ok') await commitCanonItemUpdate(result.value);
  return result;
}

/** Un-hide a canon item's icon: clears the "hidden" sentinel (→ null) via the
 *  regenerate callable, which re-triggers generation. */
export async function unhideCanonIcon(id: string): Promise<Result<void, DomainError>> {
  return callRegenerateCanonIcon(id);
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
