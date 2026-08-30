// The one arithmetic reconciliation of a recipe's three time fields (issue #1116).
//
// `totalTimeMinutes >= prepTimeMinutes + cookTimeMinutes` is asked of the model
// by `TIME_RULES` and enforced here, because asking is not guaranteeing — the
// second half of issue #952 is documents where a model stated a total below its
// own parts (Paneer Makhanwala: 10 + 35 → 35). It is not cosmetic: `cookShape`
// derives the displayed hands-on figure as `total − timer waits`, so an
// understated total either poisons that number or trips its fallback down to the
// equally-optimistic prep.
//
// This expression used to exist twice — once in `assembleRecipeDraft` (chat
// authoring, both imports, chat amend, Refresh) and once in
// `reconcileEstimatedTimes` (the re-estimate trigger) — byte-for-byte identical
// apart from ONE clause, with nothing recording that the difference was meant.
// Both run on production writes, so changing `>=` to `>`, or reordering the fold,
// would have applied to one write path and not the other with every gate green.
// That divergence is now the `deriveMissingTotal` argument, and both answers for
// the same input are pinned by one test.
//
// Pure, no I/O, no clock (CLAUDE.md Rule 1).

/** A recipe's three time figures, before or after reconciliation. */
export type RecipeTimes = {
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
};

/**
 * Impose `total >= prep + cook` on three raw numbers, then fold the zeros.
 *
 * Two jobs, in this order, and the order is load-bearing:
 *
 *   1. **Reconcile, from the RAW values.** A stated total below the parts is
 *      RAISED to them; one above them is left alone, because the excess is an
 *      unattended wait (marinating, proving, chilling) and those are real. Both
 *      parts must be known: one known part is not a floor for a total, and
 *      deriving from one part would invent the other as 0.
 *   2. **Fold 0 → null, and only afterwards.** "No cooking" is a real answer for a
 *      salad or a dressing and the extractor accepts it as `0` (issue #739), but a
 *      stored recipe has one way to say "no time to state" — null. Reconciling
 *      first means prep 15 + cook 0 still totals 15; folding first would read a
 *      genuine "no cooking" as "not stated" and throw the total away. A derived
 *      total of 0 (both parts 0) folds too — a recipe that takes no time at all is
 *      the nonsense the schema already rejects on the way in.
 *
 * `deriveMissingTotal` decides the one case the two call sites answer differently:
 * both parts known, no total stated. `true` fills it in from the parts; `false`
 * leaves it null, so a merge downstream cannot have a fabricated total win over a
 * stored one. It is a parameter and not a constant because each answer is a data
 * loss bug on the other's path — see the call sites, which each argue their own.
 * Every other input is answered identically whichever way it is set.
 */
export function reconcileRecipeTimes(
  raw: Readonly<RecipeTimes>,
  { deriveMissingTotal }: { deriveMissingTotal: boolean },
): RecipeTimes {
  const partsTotal =
    raw.prepTimeMinutes !== null && raw.cookTimeMinutes !== null
      ? raw.prepTimeMinutes + raw.cookTimeMinutes
      : null;
  const total =
    partsTotal === null || (raw.totalTimeMinutes === null && !deriveMissingTotal)
      ? raw.totalTimeMinutes
      : Math.max(raw.totalTimeMinutes ?? 0, partsTotal);

  const zeroToNull = (n: number | null): number | null => (n === 0 ? null : n);
  return {
    prepTimeMinutes: zeroToNull(raw.prepTimeMinutes),
    cookTimeMinutes: zeroToNull(raw.cookTimeMinutes),
    totalTimeMinutes: zeroToNull(total),
  };
}
