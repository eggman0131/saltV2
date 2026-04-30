import { failure, success } from '@salt/shared-types';
import { ErrorCode } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from './entities/CanonItem.js';
import type { CanonLocalStorePort } from './ports/CanonLocalStorePort.js';
import type { AisleStorePort } from './ports/AisleStorePort.js';
import type { EmbeddingPort } from './ports/EmbeddingPort.js';
import type { CanonArbitrationPort } from './ports/CanonArbitrationPort.js';
import type { IdGenerator } from './ports/IdGenerator.js';
import type { MatchLoggingPort } from './ports/MatchLoggingPort.js';
import type { MatchCandidate } from './matching.js';
import { MATCH_THRESHOLDS } from './matching.js';
import type { FinalDecision } from './logging/MatchLogEntry.js';
import { MatchLogBuilder } from './logging/MatchLogBuilder.js';
import { normaliseName } from './queries/normaliseName.js';
import { tokenMatch } from './queries/tokenMatch.js';
import { stringSimilarity } from './queries/stringSimilarity.js';
import { findClosestMatch } from './queries/findClosestMatch.js';
import { embedMatch } from './queries/embedMatch.js';
import { createCanonItem } from './commands/createCanonItem.js';

export function createCanonMatchingPipeline(
  store: CanonLocalStorePort,
  aisleStore: AisleStorePort,
  embedding: EmbeddingPort,
  arbitration: CanonArbitrationPort,
  ids: IdGenerator,
  logging: MatchLoggingPort | null,
) {
  return {
    async matchOrCreate(
      rawName: string,
      selectedAisle?: string | null,
    ): Promise<Result<CanonItem, DomainError>> {
      const normalisedName = normaliseName(rawName);
      if (!normalisedName) {
        return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_CANON_NAME });
      }

      const itemsResult = await store.list();
      if (itemsResult.kind !== 'ok') return itemsResult;
      const items = itemsResult.value;

      const logBuilder = logging ? new MatchLogBuilder() : null;
      const runId = ids.newCanonId();
      logBuilder?.start(rawName, normalisedName);

      const commitLog = (decision: FinalDecision, finalItemId: string | null): void => {
        if (!logBuilder || !logging) return;
        const entry = logBuilder.complete(runId, decision, finalItemId);
        void logging.write(entry).catch(() => {});
      };

      // Stages 1–4: pure deterministic matching
      const stage1to4 = findClosestMatch(items, rawName, logBuilder ?? undefined);
      if (stage1to4 !== null) {
        commitLog('matched', stage1to4.item.id);
        return success(stage1to4.item);
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
        commitLog('matched', winner.item.id);
        return success(winner.item);
      }

      // Collect near-miss candidates from stages 2 & 4 above aiThreshold for stage 6.
      // (Stage 5 returned nothing, so no embed candidates to add here.)
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

      // Stage 6: AI arbitration when near-miss candidates exist
      if (aiCandidates.length > 0) {
        const aislesResult = await aisleStore.load();
        const aisles = aislesResult.kind === 'ok' ? (aislesResult.value ?? []) : [];

        const arbResult = await arbitration.arbitrate({
          normalisedName,
          candidates: aiCandidates,
          aisles,
        });

        const arbMatched = arbResult.kind === 'ok' && arbResult.value.kind === 'match';
        logBuilder?.addStage({
          stage: 6,
          stageName: 'ai_arbitration',
          threshold: MATCH_THRESHOLDS.aiThreshold,
          passed: arbMatched,
          candidates: aiCandidates.map((c) => ({ itemId: c.item.id, score: c.confidence })),
        });

        if (arbResult.kind === 'ok') {
          const arb = arbResult.value;

          if (arb.kind === 'match') {
            const matched = items.find((i) => i.id === arb.itemId);
            if (matched !== undefined) {
              commitLog('ai_arbitrated', matched.id);
              return success(matched);
            }
          }

          if (arb.kind === 'new') {
            // User-provided aisle takes priority; fall back to AI suggestion, then 'uncategorised'
            const aisleId = selectedAisle ?? arb.aisleId ?? 'uncategorised';
            return persistNew(store, ids, arb.canonName, aisleId, commitLog);
          }

          // arb.kind === 'no-match': fall through to create from rawName
        }
        // arbitration port error: fall through to create from rawName
      }

      // No match found anywhere: create a new item from rawName
      return persistNew(store, ids, rawName, selectedAisle ?? 'uncategorised', commitLog);
    },
  };
}

// Prefer approved items (needs_approval = false); among equals, take highest confidence.
function pickBest(candidates: readonly MatchCandidate[]): MatchCandidate {
  const approved = candidates.filter((c) => !c.item.needs_approval);
  const pool = approved.length > 0 ? approved : [...candidates];
  return pool.reduce((best, c) => (c.confidence > best.confidence ? c : best), pool[0]!);
}

async function persistNew(
  store: CanonLocalStorePort,
  ids: IdGenerator,
  name: string,
  aisle: string,
  commitLog: (decision: FinalDecision, finalItemId: string | null) => void,
): Promise<Result<CanonItem, DomainError>> {
  const result = createCanonItem({ name, aisle }, ids);
  if (result.kind !== 'ok') return result;
  const item = result.value;
  const saved = await store.upsert(item);
  if (saved.kind !== 'ok') return saved;
  commitLog('created', item.id);
  return success(item);
}
