import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from '../queries/normaliseName.js';
import { recordPendingCanonChange } from './recordPendingCanonChange.js';

export function appendCanonSynonym(
  item: CanonItem,
  rawName: string,
  reasoning?: string,
): CanonItem {
  const normalised = normaliseName(rawName);
  // NO-OP RETURNS `item` BY REFERENCE, and that identity is load-bearing:
  // matchOrCreate's resolveMatch uses `updated !== item` to decide whether to
  // write. Never record a pending change above this guard, or every no-op match
  // becomes a Firestore write.
  if (!normalised || normalised === normaliseName(item.name) || item.synonyms.includes(normalised))
    return item;
  const trimmedRaw = rawName.trim();
  return recordPendingCanonChange(
    {
      ...item,
      synonyms: [...item.synonyms, normalised],
      needs_approval: true,
      ...(reasoning !== undefined ? { reasoning } : {}),
    },
    {
      kind: 'synonym_added',
      synonym: normalised,
      // Carry the entry it came from only when it differs from the synonym we
      // stored. A LITERAL compare, deliberately (issue #193): a normalised one
      // would always be true and would silently drop the `from "2 tins chopped
      // toms"` line the review panel exists to show.
      ...(trimmedRaw !== normalised ? { rawInput: trimmedRaw } : {}),
    },
  );
}
