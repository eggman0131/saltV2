import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AisleStorePort } from '../ports/AisleStorePort.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';

export async function getAisleUsage(
  aisleStore: AisleStorePort,
  canonStore: CanonLocalStorePort,
): Promise<ReadResult<Map<string, number>, DomainError>> {
  const [aisleResult, canonResult] = await Promise.all([aisleStore.load(), canonStore.list()]);
  if (aisleResult.kind === 'err') return aisleResult;
  if (canonResult.kind === 'err') return canonResult;

  const usage = new Map<string, number>((aisleResult.value ?? []).map((a) => [a.id, 0]));
  for (const item of canonResult.value) {
    if (item.aisleId !== null && usage.has(item.aisleId)) {
      usage.set(item.aisleId, (usage.get(item.aisleId) ?? 0) + 1);
    }
  }

  return success(usage);
}
