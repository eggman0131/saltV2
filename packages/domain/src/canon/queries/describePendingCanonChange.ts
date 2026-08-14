import type { PendingCanonChange } from '../entities/CanonItem.js';

/**
 * A pending change flattened for rendering (issue #193).
 *
 * A RENDER CONTRACT, not a formatted string: the components own every word, so
 * the queue row and the detail panel can each say it in the shape that fits
 * (`+ synonym "chopped toms"` vs `Added synonym "chopped toms"`). Defined
 * inline here rather than in schemas/ — it is derived, never persisted (see
 * MatchLogSummary for the same precedent).
 *
 * `synonym`/`rawInput`/`origin` are `null` rather than absent so a template can
 * test one thing. `rawInput: null` means "same as the value it produced", NOT
 * "unknown".
 *
 * `fromAisleId` is deliberately NOT surfaced: the aisle it names has just been
 * merged away or deleted, so it can never resolve to a name. It stays on the
 * persisted record for provenance; the words stand without it.
 */
export interface PendingCanonChangeDescription {
  readonly kind: PendingCanonChange['kind'];
  readonly synonym: string | null;
  readonly rawInput: string | null;
  /** Which admin action cleared the aisle — the difference between "you merged"
   *  and "you deleted". `null` for every other kind. */
  readonly origin: Extract<PendingCanonChange, { kind: 'aisle_cleared' }>['origin'] | null;
}

export function describePendingCanonChange(
  change: PendingCanonChange,
): PendingCanonChangeDescription {
  return {
    kind: change.kind,
    synonym: change.kind === 'synonym_added' ? change.synonym : null,
    rawInput: change.kind === 'aisle_cleared' ? null : (change.rawInput ?? null),
    origin: change.kind === 'aisle_cleared' ? change.origin : null,
  };
}
