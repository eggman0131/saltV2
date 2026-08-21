import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from '../queries/normaliseName.js';
import { recordPendingCanonChange } from './recordPendingCanonChange.js';

/**
 * Answers "is this ingredient text the name of a DERIVATION rather than another
 * name for the thing itself" — in practice, "is it claimed by a product form".
 *
 * INJECTED rather than imported. The honest implementation is
 * `(name) => resolveProductForm(name, forms) !== null`, but `productForm/`
 * already imports `normaliseName` from `canon/`, so calling it from here would
 * close a module cycle and fail `pnpm depcruise` (Rule 8). Passing the answer in
 * keeps the dependency arrow pointing one way and leaves the policy — which
 * forms exist, and whether they could even be read — at the edge that knows.
 */
export type DerivedNamePredicate = (rawName: string) => boolean;

export interface AppendCanonSynonymOptions {
  readonly reasoning?: string;
  /**
   * Omitted (or absent) means "no opinion", and the append proceeds exactly as
   * it always has. That default is deliberate: a caller that could not read the
   * product forms degrades to today's behaviour rather than to a blanket refusal
   * to record synonyms (Rule 10), matching how an empty `producedCanonNames`
   * disables `has_producer` in `proposalRejectionReason`.
   */
  readonly isDerivedName?: DerivedNamePredicate;
}

/**
 * A synonym asserts IDENTITY: "this text is another name for this canon item".
 * A product form asserts DERIVATION: "this text is a thing you get FROM that
 * canon item, at this yield". They are different claims about different
 * relationships, and the matcher reads the synonym list as the identity one.
 *
 * Nothing used to stop a derivation being written into the identity field, and
 * production shows the result: `lime zest` and `fresh lime juice` sit in Lime's
 * synonym list, alongside a product form that says the same two strings are
 * conversions from a lime. Once that synonym exists, `findClosestMatch` answers
 * at stage 3 (exact synonym) — a confident, wrong "zest IS a lime" — and the
 * yield is silently lost, so the shopping list buys one lime for a recipe that
 * wanted a tablespoon of zest. It also forecloses the fix: any ordering that
 * consults canon before forms can no longer tell the two cases apart, because
 * the one field now carries both.
 *
 * So the write is refused at the single site that performs it, which is what
 * makes the invariant total — a future third caller cannot forget it.
 */
export function appendCanonSynonym(
  item: CanonItem,
  rawName: string,
  options: AppendCanonSynonymOptions = {},
): CanonItem {
  const { reasoning, isDerivedName } = options;
  const normalised = normaliseName(rawName);
  // NO-OP RETURNS `item` BY REFERENCE, and that identity is load-bearing:
  // matchOrCreate's resolveMatch uses `updated !== item` to decide whether to
  // write. Never record a pending change above this guard, or every no-op match
  // becomes a Firestore write.
  if (!normalised || normalised === normaliseName(item.name) || item.synonyms.includes(normalised))
    return item;
  // Refused for the same reason and by the same route as the guards above: the
  // match itself still stands and is still returned by the caller, we simply
  // decline to record a derivation as if it were another name for the parent.
  if (isDerivedName?.(rawName) === true) return item;
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
