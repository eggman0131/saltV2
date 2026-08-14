import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleLocalStorePort } from '../ports/AisleLocalStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';
import { recordPendingCanonChange } from './recordPendingCanonChange.js';

export type ItemMergeChoice = 'move' | 'unassign';

export interface PerItemMergeChoice {
  readonly canonItemId: string;
  readonly choice: ItemMergeChoice;
}

export interface MergeAislesInput {
  readonly targetId: string;
  readonly sourceIds: readonly string[];
  readonly perItemChoices: readonly PerItemMergeChoice[];
}

export async function mergeAisles(
  input: MergeAislesInput,
  store: AisleLocalStorePort,
  canonStore: CanonLocalStorePort,
): Promise<ReadResult<void, DomainError>> {
  const sourceSet = new Set(input.sourceIds);
  const choiceMap = new Map(input.perItemChoices.map((c) => [c.canonItemId, c.choice]));

  // Apply per-item choices; items not in choiceMap default to 'unassign'
  const canonResult = await canonStore.list();
  if (canonResult.kind === 'err') return canonResult;

  for (const item of canonResult.value) {
    if (item.aisleId === null || !sourceSet.has(item.aisleId)) continue;
    const choice = choiceMap.get(item.id) ?? 'unassign';
    // Only the unassign branch flags the item, so only it records why (issue
    // #193): a move keeps the item filed and needs no review. `fromAisleId` is
    // read here, BEFORE the aisle is nulled — it names the source aisle this
    // merge is about to delete, kept for provenance, never for display.
    const updated =
      choice === 'move'
        ? { ...item, aisleId: input.targetId }
        : recordPendingCanonChange(
            { ...item, aisleId: null, needs_approval: true },
            { kind: 'aisle_cleared', fromAisleId: item.aisleId, origin: 'aisle_merge' },
          );
    const upsertResult = await canonStore.upsert(updated);
    if (upsertResult.kind === 'err') return upsertResult;
  }

  // Delete source aisles
  const loadResult = await store.load();
  if (loadResult.kind === 'err') return loadResult;

  const existing = loadResult.value ?? [];
  const remaining = existing.filter((a) => !sourceSet.has(a.id));

  const saveResult = await store.save(remaining);
  if (saveResult.kind === 'err') return saveResult;

  return success(undefined);
}
