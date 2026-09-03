// The rule scripts/backfill-recipe-times.mjs's SECOND pass turns on (issue
// #1210): does a stored recipe carry a phase strip? It decides both which
// recipes that pass asks and whether `--verify` may call the library done, so it
// is pulled out where a test can reach it — the same reason
// scripts/lib/recipeTimesEstimated.mjs exists (its own header explains why the
// script has no other seam: it parses argv, reaches `gcloud` and the network at
// top level, so importing it runs it).
//
// ─── This is a hand-copy of `recipePhaseTotals().hasPhases` ───────────────────
//
// `packages/domain/src/recipe/queries/recipePhaseTotals.ts:33-42` is the
// specification, and a repo-root script cannot resolve `@salt/domain` (the
// script states that bargain for its `COOKABLE_KINDS` list). So the rule is
// restated here, and CLAUDE.md rule 12 applies: the restatement gets a test that
// goes red when it drifts, rather than a comment claiming it agrees.
//
// The rule, in full:
//
//   - an ABSENT `metadata.phases` is no strip (every document written before
//     #1122 shipped lacks the key);
//   - an EMPTY list is no strip — `reconcileRecipePhases` stores `phases: []`
//     when a model's answer omits a strip, so this is a real stored state under a
//     fresh `timesEstimatedAt` stamp, which is precisely why the second pass
//     cannot select on the stamp;
//   - a strip whose minutes SUM TO ZERO is a strip. A cook who zeroed three named
//     blocks by hand has stated a timing, and re-asking it would overwrite that.
//     `hasPhases` is deliberately not `elapsedMinutes > 0`, and neither is this.

/**
 * Decode Firestore REST's `metadata.phases` into a plain list of phases, or
 * `null` when the document has no such key.
 *
 * Firestore REST encodes an array as `{ arrayValue: { values: [...] } }` — and
 * an EMPTY array as `{ arrayValue: {} }`, with `values` omitted entirely. That
 * omission decodes to `[]`, not to `null`: "stored an empty strip" and "has no
 * strip key" are different documents even though `hasPhaseStrip` gives them the
 * same answer, and flattening them here would hide the distinction from anyone
 * reading a decode in isolation.
 *
 * Minutes are read with the same absent-reads-as-null care the script's
 * `readNumber` takes, and for the same reason — but note the boundary: the
 * strip ANSWER never depends on them. They are decoded so the shape is a
 * faithful `RecipePhase`, not because `hasPhaseStrip` inspects them.
 */
export function decodeRecipePhases(field) {
  if (!field?.arrayValue) return null;
  return (field.arrayValue.values ?? []).map((entry) => {
    const fields = entry?.mapValue?.fields ?? {};
    return {
      label: fields.label?.stringValue ?? '',
      handsOnMinutes: minutes(fields.handsOnMinutes),
      handsOffMinutes: minutes(fields.handsOffMinutes),
    };
  });
}

/**
 * Does this recipe carry a phase strip? Takes a decoded list (or `null`).
 *
 * Anything that is not a non-empty list is no strip — including a `null` from a
 * document with no key, and a value that somehow decoded to a non-array.
 */
export function hasPhaseStrip(phases) {
  return Array.isArray(phases) && phases.length > 0;
}

// Firestore REST puts an integer in `integerValue` AS A STRING and a
// non-integer in `doubleValue` as a number; absent and null both read as 0 here
// rather than null, because `RecipePhaseSchema` types both minutes as plain
// numbers and a decoded phase should satisfy that shape.
function minutes(field) {
  if (!field) return 0;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  return 0;
}
