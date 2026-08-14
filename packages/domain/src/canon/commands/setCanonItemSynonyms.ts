import { success } from '@salt/shared-types';
import type { DomainError, Result } from '@salt/shared-types';
import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from '../queries/normaliseName.js';

export function setCanonItemSynonyms(
  item: CanonItem,
  synonyms: readonly string[],
): Result<CanonItem, DomainError> {
  const cleaned = [...new Set(synonyms.map((s) => s.trim()).filter((s) => s.length > 0))];
  // Editing the synonyms is how you disagree with a recorded `synonym_added`
  // (issue #193) — there is no reject action. So drop any record whose synonym
  // no longer normalises onto a synonym that survived: the review panel must
  // never claim credit for a synonym that is no longer there. `created` records
  // name no synonym and are untouched. Both callers get this — the detail
  // page's synonyms editor and Split.
  const remaining = new Set(cleaned.map(normaliseName));
  const pendingChanges = item.pendingChanges?.filter(
    (c) => c.kind !== 'synonym_added' || remaining.has(normaliseName(c.synonym)),
  );
  const { pendingChanges: _dropped, ...rest } = item;
  return success({
    ...rest,
    synonyms: cleaned,
    // Omit the key when nothing is left, so a fully-edited item matches an item
    // that never had a record (absent, never `[]`).
    ...(pendingChanges && pendingChanges.length > 0 ? { pendingChanges } : {}),
  });
}
