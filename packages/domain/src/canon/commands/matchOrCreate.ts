import { failure, success } from '@salt/shared-types';
import { ErrorCode } from '@salt/shared-types';
import type { DomainError, ReadResult, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { Aisle } from '../entities/Aisle.js';
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

/**
 * Review-queue markers written to `CanonItem.reasoning` when a new item is
 * created but arbitration could not supply a canonical name. The raw input is
 * kept verbatim and `needs_approval` (default true) surfaces it for a human to
 * fix. Two distinct strings so the queue can tell a failed AI call apart from
 * the AI running but not matching.
 */
export const ARBITRATION_FAILED_REASONING =
  'AI arbitration call failed; raw input kept — needs review';
export const ARBITRATION_NO_MATCH_REASONING =
  'AI arbitration returned no match; raw input kept — needs review';

export interface MatchOrCreateInput {
  readonly rawName: string;
  readonly selectedAisleId?: string | null | undefined;
  /** Skip match stages and force a new item. Pipeline still runs aisle arbitration. */
  readonly forceCreate?: boolean;
  readonly rawText?: string;
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

/**
 * Single-item entry point. Preserved public signature and behaviour — it is a
 * batch of one, so there is exactly one matching implementation (`resolveOne`)
 * that the batch and single-item paths cannot drift apart from.
 */
export async function matchOrCreate(
  input: MatchOrCreateInput,
  ports: MatchOrCreatePorts,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  return (await matchOrCreateBatch([input], ports))[0]!;
}

/**
 * The one matching function. Reads the canon snapshot and aisle list **once**,
 * batch-embeds every input name into a warm cache, then runs `resolveOne` per
 * input against a **growing** in-memory snapshot: each resolved item (new
 * creations and synonym/`needs_approval` mutations alike) is folded back so
 * later inputs see what a fresh re-read would show and two inputs resolving to
 * the same new item collapse to one. Returns an order-preserving array of
 * results, one per input.
 */
export async function matchOrCreateBatch(
  inputs: readonly MatchOrCreateInput[],
  ports: MatchOrCreatePorts,
): Promise<ReadResult<MatchOrCreateResult, DomainError>[]> {
  // One canon read for the whole batch. A failure surfaces to every input.
  const itemsResult = await ports.store.list();
  if (itemsResult.kind !== 'ok') return inputs.map(() => itemsResult);

  const snapshot = new Map<string, CanonItem>();
  for (const item of itemsResult.value) snapshot.set(item.id, item);

  // One aisle read for the whole batch.
  const aisles = await loadAisles(ports.aisleStore);

  // Pre-compute every input's query embedding in one batched call and serve
  // `embedMatch` (unchanged) from the warm cache via a wrapped port.
  const resolvePorts: MatchOrCreatePorts = {
    ...ports,
    embedding: await buildEmbeddingCache(ports.embedding, inputs),
  };

  const results: ReadResult<MatchOrCreateResult, DomainError>[] = [];
  for (const input of inputs) {
    const result = await resolveOne(input, [...snapshot.values()], aisles, resolvePorts);
    if (result.kind === 'ok') snapshot.set(result.value.item.id, result.value.item);
    results.push(result);
  }
  return results;
}

/**
 * Wrap an `EmbeddingPort` so `computeEmbedding(name)` is served from a cache
 * pre-filled by a single `computeEmbeddings` call over all input names. When
 * the underlying port has no batch method, the cache stays empty and lookups
 * fall through to per-name `computeEmbedding` — identical to the old behaviour.
 */
async function buildEmbeddingCache(
  base: EmbeddingPort,
  inputs: readonly MatchOrCreateInput[],
): Promise<EmbeddingPort> {
  const names = inputs
    .map((i) => normaliseName(i.rawName))
    .filter((n): n is string => n.length > 0);
  const unique = [...new Set(names)];

  const cache = new Map<string, ReadResult<readonly number[], DomainError>>();
  if (unique.length > 0 && base.computeEmbeddings) {
    const batched = await base.computeEmbeddings(unique);
    if (batched.kind === 'ok') {
      unique.forEach((name, i) => {
        const vec = batched.value[i];
        if (vec !== undefined) cache.set(name, success(vec));
      });
    } else {
      for (const name of unique) cache.set(name, batched);
    }
  }

  return {
    ...base,
    computeEmbedding: async (text) => cache.get(text) ?? base.computeEmbedding(text),
  };
}

/**
 * Per-item matching core (stages 1–6 + arbitration + persist). The canon
 * snapshot and aisle list are **injected** rather than loaded here, so the
 * batch can share one read across all inputs. Sole source of matching truth.
 */
async function resolveOne(
  input: MatchOrCreateInput,
  items: readonly CanonItem[],
  aisles: readonly Aisle[],
  ports: MatchOrCreatePorts,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const { rawName, selectedAisleId, forceCreate = false, rawText } = input;
  const { store, embedding, arbitration, ids, logging } = ports;

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
    let suggestedAisleId: string | null = null;
    let forceExtras: ArbitrationExtras | undefined;
    let forceName = rawName;
    if (aisles.length > 0 && selectedAisleId == null) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({
        normalisedName,
        candidates: [],
        aisles,
        ...(rawText !== undefined ? { rawText } : {}),
      });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        suggestedAisleId = arbResult.value.aisleId ?? null;
        forceExtras = extrasFromNew(arbResult.value);
        forceName = arbResult.value.canonName;
      } else {
        forceExtras = { reasoning: arbitrationFailureReasoning(arbResult) };
      }
      logArbitration(logBuilder, 'aisle_suggestion', 0, aisles.length, arbResult, arbDuration);
    }
    return persistNew(
      store,
      ids,
      forceName,
      selectedAisleId ?? suggestedAisleId ?? null,
      commitLog,
      forceExtras,
    );
  }

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
      rawText,
      selectedAisleId ?? null,
      store,
      aisles,
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

  // Single near-miss from a deterministic stage: match directly without calling AI.
  // Embedding candidates (stage 5) always go to arbitration — cosine similarity
  // at 0.75 is not precise enough to auto-bind without AI review.
  if (shortlist.length === 1 && shortlist[0]!.stage !== 5) {
    return resolveMatch(store, shortlist[0]!.item, rawName, 'matched', commitLog);
  }

  if (shortlist.length > 0) {
    return arbitrateShortlist(
      shortlist,
      'near_miss_shortlist',
      normalisedName,
      rawName,
      rawText,
      selectedAisleId ?? null,
      store,
      aisles,
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
  let createName = rawName;
  if (finalAisleId === null) {
    if (aisles.length > 0) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({
        normalisedName,
        candidates: [],
        aisles,
        ...(rawText !== undefined ? { rawText } : {}),
      });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        finalAisleId = arbResult.value.aisleId ?? null;
        newExtras = extrasFromNew(arbResult.value);
        createName = arbResult.value.canonName;
      } else {
        newExtras = { reasoning: arbitrationFailureReasoning(arbResult) };
      }
      logArbitration(logBuilder, 'aisle_suggestion', 0, aisles.length, arbResult, arbDuration);
    }
  }
  return persistNew(store, ids, createName, finalAisleId, commitLog, newExtras);
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

function arbitrationFailureReasoning(
  arbResult: Awaited<ReturnType<CanonArbitrationPort['arbitrate']>>,
): string {
  return arbResult.kind === 'err' ? ARBITRATION_FAILED_REASONING : ARBITRATION_NO_MATCH_REASONING;
}

async function loadAisles(aisleStore: AisleLocalStorePort) {
  const aislesResult = await aisleStore.load();
  return aislesResult.kind === 'ok' ? (aislesResult.value ?? []) : [];
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
  reasoning?: string,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const updated = appendCanonSynonym(item, rawName, reasoning);
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
  rawText: string | undefined,
  selectedAisleId: string | null,
  store: CanonLocalStorePort,
  aisles: readonly Aisle[],
  arbitration: CanonArbitrationPort,
  ids: IdGenerator,
  commitLog: (
    decision: FinalDecision,
    finalItemId: string | null,
    finalItemName?: string | null,
  ) => void,
  logBuilder: MatchLogBuilder | null,
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const arbT0 = Date.now();
  const arbResult = await arbitration.arbitrate({
    normalisedName,
    candidates: [...shortlist],
    aisles,
    ...(rawText !== undefined ? { rawText } : {}),
  });
  const arbDuration = Math.max(0, Date.now() - arbT0);
  logArbitration(logBuilder, reason, shortlist.length, aisles.length, arbResult, arbDuration);

  if (arbResult.kind === 'ok') {
    const arb = arbResult.value;
    if (arb.kind === 'match') {
      const matchedItem = shortlist.find((c) => c.item.id === arb.itemId)?.item ?? null;
      if (matchedItem !== null) {
        return resolveMatch(store, matchedItem, rawName, 'ai_arbitrated', commitLog, arb.reasoning);
      }
      // AI returned an unknown id — fall through to highest-confidence fallback.
    } else if (arb.kind === 'new') {
      return persistNew(
        store,
        ids,
        arb.canonName,
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
