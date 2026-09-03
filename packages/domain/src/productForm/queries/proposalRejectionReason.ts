import { normaliseName } from '../../canon/index.js';
import type { ProductFormProposal } from '../../schemas/productFormArbitration.js';

/**
 * Why an otherwise well-formed product-form proposal must NOT be minted.
 *
 * `decideProductFormProposal` answers "is this a coherent proposal" from the AI
 * output alone. This answers the separate question "should it exist at all",
 * which needs context the arbitration call does not have. Kept apart for that
 * reason: arbitration is per-ingredient and stateless, while both rules below are
 * facts about the rest of the library.
 */
export type ProposalRejection = 'self_reference' | 'has_producer' | 'label_omits_parent';

/**
 * A product form exists to express a FIXED PHYSICAL CONVERSION between two
 * different things: one lime yields 30 ml of juice, one bulb holds ten cloves.
 * Two situations look like a form to the model and are not one.
 *
 * `self_reference` — the form's own label names its parent. A form converting a
 * thing into itself carries no information, and its yield is meaningless
 * whatever number the model picked. Observed in production as
 * `Garlic sauce → Garlic Sauce`, and — past a first version of this check that
 * compared the two names for equality — as `Leftover garlic sauce → Garlic
 * Sauce` and `Warm water → Water`. A qualifier on the front does not make a new
 * thing, so the test is now the head noun rather than the whole string.
 *
 * `has_producer` — the ingredient names something a recipe in the library
 * PRODUCES (`producesCanonId`). "Buy or make" already owns that ingredient: the
 * add-to-list sheet offers the producing recipe, and the canon item is bought
 * directly when the user would rather buy it. Modelling it as a form on top is
 * not merely redundant, it is wrong, because there is no fixed conversion to
 * state — chicken stock comes from a cube, a carton or a carcass, at a different
 * ratio each way. Observed in production as `Chicken stock → Whole Chicken`
 * with a yield of 500 ml per bird, which put whole chickens on the shopping list
 * in place of stock. The model reached for that parent precisely BECAUSE the
 * honest answer was not available to it: there was no stock-cube canon in the
 * candidate list, and a preference list with no right answer in it still gets an
 * answer.
 *
 * `label_omits_parent` — the label shares NO word with the parent it is being
 * filed under (issue #1180). A form's label is not display-only: `resolveProductForm`
 * matches it on equal terms with the matchers (issue #818), so a bare component
 * word — "Zest", "Juice", "Stock" — is a matching phrase that names no parent at
 * all. The arbitration prompt has forbidden exactly this for the `matcher` field
 * since #500, with the reason spelled out beside it; the label line was written
 * before #818 made the label matching input, and was never revisited. This is
 * that rule, enforced rather than asked for.
 *
 * It is the WRITE-side half of a pair. `resolveProductForm`'s contested-phrase
 * rule already makes a stored bare label harmless to resolution; this stops the
 * table filling with rows whose display name is "Zest" and whose label
 * `findFormWithSameLabel` still keys on. Neither substitutes for the other: this
 * one cannot touch a label already stored, or one an admin types into the form
 * editor, and it is deliberately not a `.refine()` on `ProductFormSchema` —
 * a stored document that violates it must stay readable.
 *
 * Its boundary, stated rather than rounded up: it asks only whether the label
 * shares SOME word with the parent name, not whether that word disambiguates.
 * "Active whey" under Plain Yogurt fails it — correctly, on this rule's own
 * terms, and harmlessly, because the rule applies to AI proposals only and no
 * stored document is re-validated. A label sharing a word with a differently-named
 * parent ("Beef stock" under "Beef Stock Cube") passes it and always will.
 *
 * Compared on `normaliseName` so the check folds case and spacing exactly like
 * every other name comparison in the matcher.
 *
 * @param producedCanonNames names of the canon items some recipe produces. An
 *   empty list disables the `has_producer` rule, which is what makes this safe
 *   to call when the caller could not read the recipe list (Rule 10) — it
 *   degrades to today's behaviour rather than to a blanket refusal.
 */
export function proposalRejectionReason(
  proposal: ProductFormProposal,
  producedCanonNames: readonly string[] = [],
): ProposalRejection | null {
  if (proposal.kind !== 'form') return null;

  const parent = normaliseName(proposal.parentName);
  const label = normaliseName(proposal.label);
  const matcher = normaliseName(proposal.matcher);

  if (parent.length > 0 && (parent === label || parent === matcher)) return 'self_reference';
  if (parent.length > 0 && sharesHeadNoun(label, parent)) return 'self_reference';

  // Checked against the LABEL and the MATCHER — what the form claims to be —
  // never the parent. A form whose PARENT happens to be produced by a recipe is
  // perfectly legitimate: "Soft Bread Rolls" produces Soft Burger Bun, and a
  // future form of a burger bun would still be a real conversion.
  const produced = new Set(producedCanonNames.map(normaliseName));
  if (produced.has(label) || produced.has(matcher)) return 'has_producer';

  // Last, so a proposal that is wrong for a more specific reason is reported by
  // that reason. Both names must be non-empty to judge anything: a parent or
  // label that normalises away leaves nothing to compare, and a rejection built
  // on nothing is worse than the row.
  if (parent.length > 0 && label.length > 0 && !sharesAnyWord(label, parent)) {
    return 'label_omits_parent';
  }

  return null;
}

/** Does the label use any of the words the parent's name is made of? */
function sharesAnyWord(normalisedLabel: string, normalisedParent: string): boolean {
  const parentWords = new Set(normalisedParent.split(' '));
  return normalisedLabel.split(' ').some((word) => parentWords.has(word));
}

/**
 * Do these two names describe the same KIND of thing?
 *
 * A real product form renames what the ingredient IS: a lime becomes juice, an
 * egg becomes a yolk, a bulb becomes a clove. The head noun changes, because the
 * derivative is a different thing from its parent and is bought, measured or
 * counted differently.
 *
 * A PREPARATION does not. Grated nutmeg is nutmeg; warm water is water; leftover
 * garlic sauce is garlic sauce. The head noun survives because nothing became
 * anything else, and the yield the model invented is a conversion from a thing
 * to itself. Left unchecked this is unbounded: every preparation verb in the
 * language — chopped, sliced, crushed, minced, softened, toasted — would mint
 * its own form against the same parent, and the table fills with rows that carry
 * no information.
 *
 * English puts the head noun of a noun phrase last, so the test is the last
 * token. That is a lexical proxy for the real question and it is imperfect in
 * one direction — "Cheddar slices" changes the noun and so survives — but its
 * failure mode is chosen: a rejected proposal falls through to ordinary canon
 * matching, where the ingredient still resolves and the household still buys the
 * parent. Nothing is lost but the row.
 *
 * Applied to the LABEL ONLY, never the matcher. A label is a display name the
 * model writes as a clean noun phrase ("Lime juice"). A matcher is ingredient
 * text as a recipe actually wrote it, and "juice of 1 lime" normalises to
 * "juice of lime" — whose last token is the parent, for a form that is entirely
 * real. The matcher keeps the equality test above and nothing more.
 */
function sharesHeadNoun(normalisedLabel: string, normalisedParent: string): boolean {
  const labelHead = normalisedLabel.split(' ').at(-1);
  const parentHead = normalisedParent.split(' ').at(-1);
  if (labelHead === undefined || parentHead === undefined) return false;
  if (labelHead.length === 0 || parentHead.length === 0) return false;
  return labelHead === parentHead;
}
