import { failure, success } from '@salt/shared-types';
import { ErrorCode } from '@salt/shared-types';
import type { DomainError, ReadResult, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { FinalDecision } from '../entities/MatchLogEntry.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';
import type { EmbeddingPort } from '../ports/EmbeddingPort.js';
import type { CanonArbitrationPort } from '../ports/CanonArbitrationPort.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { MatchLoggingPort } from '../ports/MatchLoggingPort.js';
import { MATCH_THRESHOLDS } from '../queries/matchThresholds.js';
import { MatchLogBuilder } from './buildMatchLog.js';
import { normaliseName } from '../queries/normaliseName.js';
import { tokenMatch } from '../queries/tokenMatch.js';
import { stringSimilarity } from '../queries/stringSimilarity.js';
import { findClosestMatch } from '../queries/findClosestMatch.js';
import { embedMatch } from '../queries/embedMatch.js';
import { createCanonItem } from './createCanonItem.js';
import { appendCanonSynonym } from './appendCanonSynonym.js';

export interface MatchOrCreateInput {
  readonly rawName: string;
  readonly selectedAisleId?: string | null | undefined;
  /** Skip match stages and force a new item. Pipeline still runs aisle arbitration. */
  readonly forceCreate?: boolean;
}

export type MatchOrCreateResult = {
  readonly decision: 'created' | 'matched' | 'ai_arbitrated';
  readonly item: CanonItem;
};

export interface MatchOrCreatePorts {
  readonly store: CanonLocalStorePort;
  readonly aisleStore: AisleLocalStorePort;
  readonly embedding: EmbeddingPort;
  readonly arbitration: CanonArbitrationPort;
  readonly ids: IdGenerator;
  readonly logging: MatchLoggingPort | null;
}

export async function matchOrCreate(
  input: MatchOrCreateInput,
  ports: MatchOrCreatePorts,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const { rawName, selectedAisleId, forceCreate = false } = input;
  const { store, aisleStore, embedding, arbitration, ids, logging } = ports;

  const normalisedName = normaliseName(rawName);
  if (!normalisedName) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
  }

  const logBuilder = logging ? new MatchLogBuilder() : null;
  const runId = ids.newCanonId();
  logBuilder?.start(rawName, normalisedName);

  const commitLog = (
    decision: FinalDecision,
    finalItemId: string | null,
    finalItemName: string | null = null,
  ): void => {
    if (!logBuilder || !logging) return;
    const entry = logBuilder.complete(runId, decision, finalItemId, finalItemName);
    void logging.write(entry).catch(() => {});
  };

  // Force-create: skip match stages, still run arbitration to populate aisle + item metadata.
  if (forceCreate) {
    const aisles = await loadAisles(aisleStore);
    let suggestedAisleId: string | null = null;
    let forceExtras: ArbitrationExtras | undefined;
    if (aisles.length > 0 && selectedAisleId == null) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        suggestedAisleId = arbResult.value.aisleId ?? null;
        forceExtras = extrasFromNew(arbResult.value);
      }
      logArbitration(logBuilder, 'aisle_suggestion', 0, aisles.length, arbResult, arbDuration);
    }
    return persistNew(
      store,
      ids,
      rawName,
      selectedAisleId ?? suggestedAisleId ?? null,
      commitLog,
      forceExtras,
    );
  }

  const itemsResult = await store.list();
  if (itemsResult.kind !== 'ok') return itemsResult;
  const items = itemsResult.value;
  logBuilder?.setInputItemCount(items.length);

  // Stages 1–4: pure deterministic matching
  const stage1to4 = findClosestMatch(items, rawName, logBuilder ?? undefined);

  if (stage1to4.kind === 'match') {
    return resolveMatch(store, stage1to4.candidate.item, rawName, 'matched', commitLog);
  }

  if (stage1to4.kind === 'ambiguous') {
    return arbitrateShortlist(
      [...stage1to4.candidates],
      'ambiguous_near_tie',
      normalisedName,
      rawName,
      selectedAisleId ?? null,
      store,
      aisleStore,
      arbitration,
      ids,
      commitLog,
      logBuilder,
    );
  }

  // stage1to4.kind === 'none': fall through to embedding + near-miss shortlist.

  const embedCandidates = await embedMatch(
    embedding,
    normalisedName,
    items,
    logBuilder ?? undefined,
  );

  const shortlist = buildShortlist(embedCandidates, items, normalisedName);

  // Single near-miss above aiThreshold: match directly without calling AI.
  if (shortlist.length === 1) {
    return resolveMatch(store, shortlist[0]!.item, rawName, 'matched', commitLog);
  }

  if (shortlist.length > 1) {
    return arbitrateShortlist(
      shortlist,
      'near_miss_shortlist',
      normalisedName,
      rawName,
      selectedAisleId ?? null,
      store,
      aisleStore,
      arbitration,
      ids,
      commitLog,
      logBuilder,
    );
  }

  // No candidates anywhere — create a new item from rawName.
  // Run arbitration with empty candidates to populate aisle + item metadata.
  let finalAisleId = selectedAisleId ?? null;
  let newExtras: ArbitrationExtras | undefined;
  if (finalAisleId === null) {
    const aisles = await loadAisles(aisleStore);
    if (aisles.length > 0) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        finalAisleId = arbResult.value.aisleId ?? null;
        newExtras = extrasFromNew(arbResult.value);
      }
      logArbitration(logBuilder, 'aisle_suggestion', 0, aisles.length, arbResult, arbDuration);
    }
  }
  return persistNew(store, ids, rawName, finalAisleId, commitLog, newExtras);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ArbitrationExtras {
  readonly shoppingBehavior?: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
}

type ArbitrationNew = Extract<
  Awaited<ReturnType<CanonArbitrationPort['arbitrate']>>,
  { kind: 'ok' }
>['value'] & { kind: 'new' };

function extrasFromNew(arb: ArbitrationNew): ArbitrationExtras {
  return {
    shoppingBehavior: arb.shoppingBehavior,
    ...(arb.largeQuantityThreshold !== undefined
      ? { largeQuantityThreshold: arb.largeQuantityThreshold }
      : {}),
    ...(arb.unit !== undefined ? { unit: arb.unit } : {}),
    ...(arb.reasoning !== undefined ? { reasoning: arb.reasoning } : {}),
  };
}

async function loadAisles(aisleStore: AisleLocalStorePort) {
  const aislesResult = await aisleStore.load();
  return aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];
}

function logArbitration(
  logBuilder: MatchLogBuilder | null,
  reason: string,
  candidatesIn: number,
  aislesIn: number,
  arbResult: Awaited<ReturnType<CanonArbitrationPort['arbitrate']>>,
  durationMs: number,
): void {
  if (!logBuilder) return;
  const outcome = arbResult.kind === 'ok' ? arbResult.value.kind : 'error';
  logBuilder.setArbitration({
    reason,
    candidatesIn,
    aislesIn,
    prompt: arbResult.kind === 'ok' ? (arbResult.value.prompt ?? '') : '',
    rawResponse: arbResult.kind === 'ok' ? (arbResult.value.rawResponse ?? '') : '',
    outcome,
    durationMs,
  });
}

function buildShortlist(
  embedCandidates: readonly MatchCandidate[],
  items: readonly CanonItem[],
  normalisedName: string,
): MatchCandidate[] {
  const map = new Map<string, MatchCandidate>();
  for (const c of embedCandidates) map.set(c.item.id, c);
  for (const item of items) {
    const normItem = normaliseName(item.name);
    const s2 = tokenMatch(normalisedName, normItem);
    if (s2 >= MATCH_THRESHOLDS.aiThreshold) {
      const existing = map.get(item.id);
      if (!existing || s2 > existing.confidence) {
        map.set(item.id, { item, confidence: s2, stage: 2 });
      }
    }
    const s4 = stringSimilarity(normalisedName, normItem);
    if (s4 >= MATCH_THRESHOLDS.aiThreshold) {
      const existing = map.get(item.id);
      if (!existing || s4 > existing.confidence) {
        map.set(item.id, { item, confidence: s4, stage: 4 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}

async function resolveMatch(
  store: CanonLocalStorePort,
  item: CanonItem,
  rawName: string,
  decision: 'matched' | 'ai_arbitrated',
  commitLog: (
    decision: FinalDecision,
    finalItemId: string | null,
    finalItemName?: string | null,
  ) => void,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const updated = appendCanonSynonym(item, rawName);
  let finalItem = item;
  if (updated !== item) {
    const saved = await store.upsert(updated);
    if (saved.kind !== 'ok') return saved;
    finalItem = updated;
  }
  commitLog(decision, finalItem.id, finalItem.name);
  return success({ item: finalItem, decision });
}

async function arbitrateShortlist(
  shortlist: MatchCandidate[],
  reason: 'ambiguous_near_tie' | 'near_miss_shortlist',
  normalisedName: string,
  rawName: string,
  selectedAisleId: string | null,
  store: CanonLocalStorePort,
  aisleStore: AisleLocalStorePort,
  arbitration: CanonArbitrationPort,
  ids: IdGenerator,
  commitLog: (
    decision: FinalDecision,
    finalItemId: string | null,
    finalItemName?: string | null,
  ) => void,
  logBuilder: MatchLogBuilder | null,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const aisles = await loadAisles(aisleStore);

  const arbT0 = Date.now();
  const arbResult = await arbitration.arbitrate({
    normalisedName,
    candidates: [...shortlist],
    aisles,
  });
  const arbDuration = Math.max(0, Date.now() - arbT0);
  logArbitration(logBuilder, reason, shortlist.length, aisles.length, arbResult, arbDuration);

  if (arbResult.kind === 'ok') {
    const arb = arbResult.value;
    if (arb.kind === 'match') {
      const matchedItem = shortlist.find((c) => c.item.id === arb.itemId)?.item ?? null;
      if (matchedItem !== null) {
        return resolveMatch(store, matchedItem, rawName, 'ai_arbitrated', commitLog);
      }
      // AI returned an unknown id — fall through to highest-confidence fallback.
    } else if (arb.kind === 'new') {
      return persistNew(
        store,
        ids,
        rawName,
        selectedAisleId ?? arb.aisleId ?? null,
        commitLog,
        extrasFromNew(arb),
      );
    }
    // arb.kind === 'no-match' falls through to fallback: from a non-empty shortlist,
    // the candidates have meaningful confidence — defer to human review (needs_approval)
    // rather than silently creating a duplicate.
  }

  // AI errored, returned an unknown id, or said no-match. Fall back to the
  // highest-confidence shortlist candidate and rely on needs_approval (set
  // via appendCanonSynonym) to surface this for review.
  const fallback = shortlist[0];
  if (fallback) {
    return resolveMatch(store, fallback.item, rawName, 'ai_arbitrated', commitLog);
  }
  return persistNew(store, ids, rawName, selectedAisleId, commitLog);
}

async function persistNew(
  store: CanonLocalStorePort,
  ids: IdGenerator,
  name: string,
  aisleId: string | null,
  commitLog: (
    decision: FinalDecision,
    finalItemId: string | null,
    finalItemName?: string | null,
  ) => void,
  extras?: ArbitrationExtras,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const result = createCanonItem(
    {
      name,
      aisleId,
      ...(extras?.shoppingBehavior !== undefined
        ? { shoppingBehavior: extras.shoppingBehavior }
        : {}),
      ...(extras?.largeQuantityThreshold !== undefined
        ? { largeQuantityThreshold: extras.largeQuantityThreshold }
        : {}),
      ...(extras?.unit !== undefined ? { unit: extras.unit } : {}),
      ...(extras?.reasoning !== undefined ? { reasoning: extras.reasoning } : {}),
    },
    ids,
  );
  if (result.kind !== 'ok') return result;
  const item = result.value;
  const saved = await store.upsert(item);
  if (saved.kind !== 'ok') return saved;
  commitLog('created', item.id, item.name);
  return success({ item, decision: 'created' });
}
