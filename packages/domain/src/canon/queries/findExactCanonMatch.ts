import type { CanonItem } from '../entities/CanonItem.js';
import { normaliseName } from './normaliseName.js';
import { exactNameMatch } from './exactNameMatch.js';
import { synonymMatch } from './synonymMatch.js';

/**
 * Does this text EXACTLY name a canon item — by its own name, or by a synonym?
 *
 * Stages 1 and 3 of `findClosestMatch` and nothing else. Deliberately not a
 * shortcut for "run the matcher cheaply": the two stages this covers are the only
 * ones that answer from a string somebody WROTE DOWN, rather than from a
 * similarity score. Stage 2 (token overlap), stage 4 (edit distance) and stage 5
 * (embeddings) are all the machine guessing, and this must never speak for them.
 *
 * That distinction is what it exists for. `canonicaliseRecipeIngredients` resolves
 * product forms BEFORE canon, because a derivative rarely resembles its parent
 * closely enough to match deterministically — "lime zest" shares one token of two
 * with "Lime" — so consulting a fuzzy matcher first would swallow derivatives and
 * no form would ever be proposed. Form-first is right for guesses.
 *
 * It is wrong for answers. A synonym is in the list because a person put it there,
 * or because the review queue approved it. If someone has already said "this text
 * means this item", the model should not be asked to reconsider — and today it is:
 * every ingredient that no existing form claims goes to form arbitration, whatever
 * the canon list says, so a form can be minted over the top of a curated synonym
 * and re-minted after the operator deletes it. Deleting the form and recording a
 * synonym is exactly how a person corrects an over-eager proposal, and that
 * correction has to stick.
 *
 * Returns `null` on a tie. Two items claiming the same text is not an answer, it
 * is a duplicate for the review queue, and the caller should treat it as no answer
 * and carry on down its normal path.
 *
 * Shares stage 1's and stage 3's helpers (`exactNameMatch`, `synonymMatch`) but
 * deliberately does NOT route through `findClosestMatch`, because stage 2 —
 * token overlap — runs between the two stages this needs, so delegating would let
 * a fuzzy guess pre-empt a curated synonym (the #865/#866 regression). Its tie
 * result and return type differ from the pipeline's for the same reason. The two
 * cannot drift apart on the name question regardless: the agreement block in
 * `findClosestMatch.test.ts` fails if they ever disagree (issue #971).
 */
export function findExactCanonMatch(
  items: readonly CanonItem[],
  rawName: string,
): CanonItem | null {
  const target = normaliseName(rawName);
  if (!target) return null;

  const byName = exactNameMatch(items, target);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) return null;

  const bySynonym = synonymMatch(items, target);
  return bySynonym.length === 1 ? bySynonym[0]! : null;
}
