import { failure, success } from '@salt/shared-types';
import { ErrorCode } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
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

  // Force-create: skip match stages, still run aisle arbitration for assignment.
  if (forceCreate) {
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];
    let suggestedAisleId: string | null = null;
    if (aisles.length > 0 && selectedAisleId == null) {
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        suggestedAisleId = arbResult.value.aisleId ?? null;
      }
    }
    return persistNew(store, ids, rawName, selectedAisleId ?? suggestedAisleId ?? null, commitLog);
  }

  const itemsResult = await store.list();
  if (itemsResult.kind !== 'ok') return itemsResult;
  const items = itemsResult.value;

  // Stages 1–4: pure deterministic matching
  const stage1to4 = findClosestMatch(items, rawName, logBuilder ?? undefined);
  if (stage1to4 !== null) {
    commitLog('matched', stage1to4.item.id, stage1to4.item.name);
    return success({ item: stage1to4.item, decision: 'matched' });
  }

  // Stage 5: semantic embedding
  const embedCandidates = await embedMatch(
    embedding,
    normalisedName,
    items,
    logBuilder ?? undefined,
  );
  if (embedCandidates.length > 0) {
    const winner = pickBest(embedCandidates);
    commitLog('matched', winner.item.id, winner.item.name);
    return success({ item: winner.item, decision: 'matched' });
  }

  // Collect near-miss candidates from stages 2 & 4 above aiThreshold for stage 6.
  const aiCandidateMap = new Map<string, MatchCandidate>();
  for (const item of items) {
    const normItem = normaliseName(item.name);
    const s2 = tokenMatch(normalisedName, normItem);
    if (s2 >= MATCH_THRESHOLDS.aiThreshold) {
      aiCandidateMap.set(item.id, { item, confidence: s2, stage: 2 });
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

  // Stage 6: surface near-miss candidates to the user rather than auto-picking.
  // With a single candidate above the threshold there's no ambiguity — match directly.
  // With multiple candidates the human picks; AI arbitration was unreliable here.
  if (aiCandidates.length === 1) {
    commitLog('matched', aiCandidates[0]!.item.id, aiCandidates[0]!.item.name);
    return success({ item: aiCandidates[0]!.item, decision: 'matched' });
  }
  if (aiCandidates.length > 1) {
    const surfaced: SurfacedCandidateLog[] = aiCandidates.map((c) => ({
      itemId: c.item.id,
      itemName: c.item.name,
      confidence: c.confidence,
      stage: c.stage,
    }));
    commitLog('surfaced_candidates', null, null, surfaced);
    return success({ decision: 'candidates', candidates: aiCandidates.map((c) => c.item) });
  }

  // No match found anywhere: create a new item from rawName.
  // Run aisle arbitration with empty candidates so the AI can still suggest an aisle.
  let finalAisleId = selectedAisleId ?? null;
  if (finalAisleId === null) {
    const aislesResult = await aisleStore.load();
    const aisles = aislesResult.kind === 'ok' ? (aislesResult.value?.aisles ?? []) : [];
    if (aisles.length > 0) {
      const arbResult = await arbitration.arbitrate({ normalisedName, candidates: [], aisles });
      if (arbResult.kind === 'ok' && arbResult.value.kind === 'new') {
        finalAisleId = arbResult.value.aisleId ?? null;
      }
    }
  }
  return persistNew(store, ids, rawName, finalAisleId, commitLog);
}

function pickBest(candidates: readonly MatchCandidate[]): MatchCandidate {
  const approved = candidates.filter((c) => !c.item.needs_approval);
  const pool = approved.length > 0 ? approved : [...candidates];
  return pool.reduce((best, c) => (c.confidence > best.confidence ? c : best), pool[0]!);
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
): Promise<ReadResult<MatchOrCreateResult, DomainError>> {
  const result = createCanonItem({ name, aisleId }, ids);
  if (result.kind !== 'ok') return result;
  const item = result.value;
  const saved = await store.upsert(item);
  if (saved.kind !== 'ok') return saved;
  commitLog('created', item.id, item.name);
  return success({ item, decision: 'created' });
}
