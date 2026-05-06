import { failure, success } from '@salt/shared-types';
import { ErrorCode } from '@salt/shared-types';
import type { DomainError, ReadResult, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { FinalDecision, SurfacedCandidateLog } from '../entities/MatchLogEntry.js';
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

export interface MatchOrCreateInput {
  readonly rawName: string;
  readonly selectedAisleId?: string | null | undefined;
  /** Skip match stages and force a new item. Pipeline still runs aisle arbitration. */
  readonly forceCreate?: boolean;
}

export type MatchOrCreateResult =
  | { readonly decision: 'created' | 'matched' | 'ai_arbitrated'; readonly item: CanonItem }
  | { readonly decision: 'candidates'; readonly candidates: readonly CanonItem[] };

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
    surfacedCandidates: readonly SurfacedCandidateLog[] | null = null,
  ): void => {
    if (!logBuilder || !logging) return;
    const entry = logBuilder.complete(
      runId,
      decision,
      finalItemId,
      finalItemName,
      surfacedCandidates,
    );
    void logging.write(entry).catch(() => {});
  };

  // Force-create: skip match stages, still run arbitration to populate aisle + item metadata.
  if (forceCreate) {
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];
    let suggestedAisleId: string | null = null;
    let forceExtras: ArbitrationExtras | undefined;
    if (aisles.length > 0 && selectedAisleId == null) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        const newResult = arbResult.value;
        suggestedAisleId = newResult.aisleId ?? null;
        forceExtras = {
          shoppingBehavior: newResult.shoppingBehavior,
          ...(newResult.largeQuantityThreshold !== undefined
            ? { largeQuantityThreshold: newResult.largeQuantityThreshold }
            : {}),
          ...(newResult.unit !== undefined ? { unit: newResult.unit } : {}),
          ...(newResult.reasoning !== undefined ? { reasoning: newResult.reasoning } : {}),
        };
      }
      if (logBuilder) {
        const outcome = arbResult.kind === 'ok' ? arbResult.value.kind : 'error';
        logBuilder.setArbitration({
          reason: 'aisle_suggestion',
          candidatesIn: 0,
          aislesIn: aisles.length,
          prompt: arbResult.kind === 'ok' ? (arbResult.value.prompt ?? '') : '',
          rawResponse: arbResult.kind === 'ok' ? (arbResult.value.rawResponse ?? '') : '',
          outcome,
          durationMs: arbDuration,
        });
      }
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
    const { item } = stage1to4.candidate;
    commitLog('matched', item.id, item.name);
    return success({ item, decision: 'matched' });
  }

  if (stage1to4.kind === 'ambiguous') {
    // Near-tie: candidates are above the stop threshold but too close to auto-pick.
    // Forward to AI arbitration with the full candidate list.
    const ambCandidates = stage1to4.candidates;
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];

    const arbT0 = Date.now();
    const arbResult = await arbitration.arbitrate({
      normalisedName,
      candidates: [...ambCandidates],
      aisles,
    });
    const arbDuration = Math.max(0, Date.now() - arbT0);

    if (logBuilder) {
      const outcome = arbResult.kind === 'ok' ? arbResult.value.kind : 'error';
      logBuilder.setArbitration({
        reason: 'ambiguous_near_tie',
        candidatesIn: ambCandidates.length,
        aislesIn: aisles.length,
        prompt: arbResult.kind === 'ok' ? (arbResult.value.prompt ?? '') : '',
        rawResponse: arbResult.kind === 'ok' ? (arbResult.value.rawResponse ?? '') : '',
        outcome,
        durationMs: arbDuration,
      });
    }

    if (arbResult.kind === 'ok') {
      const arb = arbResult.value;
      if (arb.kind === 'match') {
        const matchedItem = ambCandidates.find((c) => c.item.id === arb.itemId)?.item ?? null;
        if (matchedItem !== null) {
          commitLog('ai_arbitrated', matchedItem.id, matchedItem.name);
          return success({ item: matchedItem, decision: 'ai_arbitrated' });
        }
      }
      if (arb.kind === 'new') {
        return persistNew(store, ids, rawName, selectedAisleId ?? arb.aisleId ?? null, commitLog, {
          shoppingBehavior: arb.shoppingBehavior,
          ...(arb.largeQuantityThreshold !== undefined
            ? { largeQuantityThreshold: arb.largeQuantityThreshold }
            : {}),
          ...(arb.unit !== undefined ? { unit: arb.unit } : {}),
          ...(arb.reasoning !== undefined ? { reasoning: arb.reasoning } : {}),
        });
      }
    }
    // Arbitration failed or returned no-match: create without aisle suggestion.
    return persistNew(store, ids, rawName, selectedAisleId ?? null, commitLog);
  }

  // stage1to4.kind === 'none': fall through to embedding and near-miss collection.

  // Stage 5: semantic embedding
  const embedCandidates = await embedMatch(
    embedding,
    normalisedName,
    items,
    logBuilder ?? undefined,
  );
  // Stages 5+6: merge embedding candidates with token/string near-misses into a single
  // shortlist, then let AI arbitration decide. Embedding ranks items by semantic distance;
  // the near-miss scan adds anything above aiThreshold that embedding may have missed.
  const aiCandidateMap = new Map<string, MatchCandidate>();
  for (const c of embedCandidates) {
    aiCandidateMap.set(c.item.id, c);
  }
  for (const item of items) {
    const normItem = normaliseName(item.name);
    const s2 = tokenMatch(normalisedName, normItem);
    if (s2 >= MATCH_THRESHOLDS.aiThreshold) {
      const existing = aiCandidateMap.get(item.id);
      if (!existing || s2 > existing.confidence) {
        aiCandidateMap.set(item.id, { item, confidence: s2, stage: 2 });
      }
    }
    const s4 = stringSimilarity(normalisedName, normItem);
    if (s4 >= MATCH_THRESHOLDS.aiThreshold) {
      const existing = aiCandidateMap.get(item.id);
      if (!existing || s4 > existing.confidence) {
        aiCandidateMap.set(item.id, { item, confidence: s4, stage: 4 });
      }
    }
  }
  const aiCandidates = [...aiCandidateMap.values()].sort((a, b) => b.confidence - a.confidence);

  if (aiCandidates.length > 0) {
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];

    const arbT0 = Date.now();
    const arbResult = await arbitration.arbitrate({
      normalisedName,
      candidates: [...aiCandidates],
      aisles,
    });
    const arbDuration = Math.max(0, Date.now() - arbT0);

    if (logBuilder) {
      const outcome = arbResult.kind === 'ok' ? arbResult.value.kind : 'error';
      logBuilder.setArbitration({
        reason: 'near_miss_shortlist',
        candidatesIn: aiCandidates.length,
        aislesIn: aisles.length,
        prompt: arbResult.kind === 'ok' ? (arbResult.value.prompt ?? '') : '',
        rawResponse: arbResult.kind === 'ok' ? (arbResult.value.rawResponse ?? '') : '',
        outcome,
        durationMs: arbDuration,
      });
    }

    if (arbResult.kind === 'ok') {
      const arb = arbResult.value;
      if (arb.kind === 'match') {
        const matchedItem = aiCandidates.find((c) => c.item.id === arb.itemId)?.item ?? null;
        if (matchedItem !== null) {
          commitLog('ai_arbitrated', matchedItem.id, matchedItem.name);
          return success({ item: matchedItem, decision: 'ai_arbitrated' });
        }
      }
      if (arb.kind === 'new') {
        return persistNew(store, ids, rawName, selectedAisleId ?? arb.aisleId ?? null, commitLog, {
          shoppingBehavior: arb.shoppingBehavior,
          ...(arb.largeQuantityThreshold !== undefined
            ? { largeQuantityThreshold: arb.largeQuantityThreshold }
            : {}),
          ...(arb.unit !== undefined ? { unit: arb.unit } : {}),
          ...(arb.reasoning !== undefined ? { reasoning: arb.reasoning } : {}),
        });
      }
    }

    // Arbitration failed — surface candidates so the user can decide.
    const surfaced: SurfacedCandidateLog[] = aiCandidates.map((c) => ({
      itemId: c.item.id,
      itemName: c.item.name,
      confidence: c.confidence,
      stage: c.stage,
    }));
    commitLog('surfaced_candidates', null, null, surfaced);
    return success({ decision: 'candidates', candidates: aiCandidates.map((c) => c.item) });
  }

  // No candidates anywhere — create a new item from rawName.
  // Run arbitration with empty candidates to populate aisle + item metadata.
  let finalAisleId = selectedAisleId ?? null;
  let newExtras: ArbitrationExtras | undefined;
  if (finalAisleId === null) {
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];
    if (aisles.length > 0) {
      const arbT0 = Date.now();
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      const arbDuration = Math.max(0, Date.now() - arbT0);
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        const newResult = arbResult.value;
        finalAisleId = newResult.aisleId ?? null;
        newExtras = {
          shoppingBehavior: newResult.shoppingBehavior,
          ...(newResult.largeQuantityThreshold !== undefined
            ? { largeQuantityThreshold: newResult.largeQuantityThreshold }
            : {}),
          ...(newResult.unit !== undefined ? { unit: newResult.unit } : {}),
          ...(newResult.reasoning !== undefined ? { reasoning: newResult.reasoning } : {}),
        };
      }
      if (logBuilder) {
        const outcome = arbResult.kind === 'ok' ? arbResult.value.kind : 'error';
        logBuilder.setArbitration({
          reason: 'aisle_suggestion',
          candidatesIn: 0,
          aislesIn: aisles.length,
          prompt: arbResult.kind === 'ok' ? (arbResult.value.prompt ?? '') : '',
          rawResponse: arbResult.kind === 'ok' ? (arbResult.value.rawResponse ?? '') : '',
          outcome,
          durationMs: arbDuration,
        });
      }
    }
  }
  return persistNew(store, ids, rawName, finalAisleId, commitLog, newExtras);
}

interface ArbitrationExtras {
  readonly shoppingBehavior?: ShoppingBehavior;
  readonly largeQuantityThreshold?: number;
  readonly unit?: CanonItemUnit;
  readonly reasoning?: string;
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
