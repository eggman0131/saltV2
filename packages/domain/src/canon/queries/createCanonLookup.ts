import { success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import type { CanonStorePort } from '../ports/CanonStorePort.js';
import type { CanonLookupPort } from '../ports/CanonLookupPort.js';
import { findClosestMatch } from './findClosestMatch.js';
import { normaliseName } from './normaliseName.js';

// Async factory: loads the canon set from the store once and caches it
// in a closure. The returned port is synchronous — callers do not await
// for canon lookups during recipe parsing or shopping-list manipulation.
//
// `refresh` updates the cache after a sync brings in new items, without
// reconstructing the port (so existing references in the app stay valid).
export async function createCanonLookup(
  store: CanonStorePort,
): Promise<ReadResult<CanonLookupPort, DomainError>> {
  const initial = await store.list();
  if (initial.kind !== 'ok') return initial;

  let items: readonly CanonItem[] = initial.value;

  return success({
    findClosestMatch: (rawName) => findClosestMatch(items, rawName),
    normaliseName,
    refresh: (next) => {
      items = next;
    },
  });
}
