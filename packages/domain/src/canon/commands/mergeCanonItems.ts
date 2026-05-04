import type { CanonItem } from '../entities/CanonItem.js';

/**
 * Merges a local and remote CanonItem using the canon field-precedence policy.
 *
 * Rules:
 *   synonyms   — union (case-insensitive dedup, local casing preserved)
 *   name       — remote (authoritative from cloud; prefer local once a locallyEdited flag exists)
 *   aisleId    — remote
 *   thumbnail  — remote
 *   embedding  — remote (cloud-computed)
 *   needs_approval — local OR remote (if either side wants approval, keep it)
 */
export function mergeCanonItems(local: CanonItem, remote: CanonItem): CanonItem {
  return {
    id: local.id,
    schemaVersion: 3,
    name: remote.name,
    synonyms: unionSynonyms(local.synonyms, remote.synonyms),
    aisleId: remote.aisleId,
    thumbnail: remote.thumbnail,
    embedding: remote.embedding,
    needs_approval: local.needs_approval || remote.needs_approval,
    shoppingBehavior: remote.shoppingBehavior,
    ...(remote.largeQuantityThreshold !== undefined
      ? { largeQuantityThreshold: remote.largeQuantityThreshold }
      : {}),
    // Server-authoritative sync fields come from remote.
    updatedAt: remote.updatedAt,
    revision: remote.revision,
    deletedAt: remote.deletedAt,
  };
}

function unionSynonyms(local: readonly string[], remote: readonly string[]): readonly string[] {
  const seen = new Set(local.map((s) => s.toLowerCase()));
  const additions = remote.filter((s) => !seen.has(s.toLowerCase()));
  return [...local, ...additions];
}
