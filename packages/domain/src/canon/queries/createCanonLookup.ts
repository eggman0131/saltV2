import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { CanonLocalStorePort } from '../ports/CanonLocalStorePort.js';
import type { CanonLookupPort } from '../ports/CanonLookupPort.js';
import { findClosestMatch, type FindClosestMatchResult } from './findClosestMatch.js';
import { normaliseName } from './normaliseName.js';

// Async factory: loads the canon set from the store once and caches it
// in a closure. The returned port is synchronous — callers do not await
// for canon lookups during recipe parsing or shopping-list manipulation.
//
// `refresh` updates the cache after a sync brings in new items, without
// reconstructing the port (so existing references in the app stay valid).
export async function createCanonLookup(
  store: CanonLocalStorePort,
): Promise<ReadResult<CanonLookupPort, DomainError>> {
  const initial = await store.list();
  if (initial.kind !== 'ok') return initial;

  let items: readonly CanonItem[] = initial.value;

  return success({
    // CanonLookupPort is read-only (recipe parsing, shopping-list). Return the best candidate
    // for both 'match' and 'ambiguous' results; the write pipeline (matchOrCreate) handles
    // full ambiguity routing with AI arbitration.
    findClosestMatch: (rawName) => {
      const result: FindClosestMatchResult = findClosestMatch(items, rawName);
      if (result.kind === 'match') return result.candidate;
      if (result.kind === 'ambiguous') return result.candidates[0] ?? null;
      return null;
    },
    normaliseName,
    refresh: (next) => {
      items = next;
    },
  });
}
