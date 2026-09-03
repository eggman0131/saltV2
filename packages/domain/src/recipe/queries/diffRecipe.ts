import type { Recipe, RecipePhase } from '../entities/Recipe.js';
import type { Ingredient } from '../entities/Ingredient.js';
import type { Step, StepTimer } from '../entities/Step.js';
import type {
  IngredientChange,
  IngredientDiffEntry,
  NullableNumberChange,
  NullableStringChange,
  RecipeDiff,
  RecipeFieldChange,
  RecipeMetadataDiff,
  RecipePhasesChange,
  StepChange,
  StepDiffEntry,
} from './recipeDiff.js';

// Pure recipe diff (Phase 1). Compares an `existing` recipe with an edited `draft`
// and reports only human-signal changes so a client can render a section-grouped
// summary. Domain purity: no I/O, no store, no dates — the caller supplies both
// recipes. Machine-derived fields are ignored (see recipeDiff.ts).
//
// Item identity (ingredients + steps), in four passes: stable `id` (the recipe
// flow preserves ids for unedited items), then content equality (`rawText`/
// `text`), then an exact non-content identity signal (a shared canon item, for
// ingredients), then a fuzzy content match for the survivors. The exact-content
// fallback keeps a genuinely unchanged item — whose id happened to change — from
// showing as a spurious remove+add, while a REUSED id with different content
// reads as an edit. A pure reorder with no content change matches on the
// id/content passes and is therefore omitted. Passes 3 and 4 (below) reconcile a
// reworded item that changed BOTH id and content.

interface Match<T> {
  existing: T;
  draft: T;
}

interface MatchResult<T> {
  matched: Array<Match<T>>;
  added: T[];
  removed: T[];
}

// ── Reconciling a reworded item (Passes 3 and 4) ─────────────────────────────
// Passes 1 and 2 (id, then exact content) only fire for items the AI author flow
// left byte-identical: `assembleRecipeDraft` mints a fresh `crypto.randomUUID()`
// for every step on every amend, and reuses an ingredient id ONLY on an unchanged
// `rawText`. So every genuine reword arrives with a fresh id AND changed content,
// matches neither pass, and would otherwise surface as remove + add. Passes 3 and
// 4 are what stop that (issue #1137).
//
// Pass 3 — canon identity. `identityKey` supplies a per-item EXACT signal:
// `canonId` for ingredients WHEN canonicalisation resolved one — null on a
// failed canon batch, an individual non-'ok' match, or the manual-entry path
// (`assembleRecipeDraft.ts:167,199-200`; `recipeService.ts:763,787,798`), so
// this pass is a bonus when the signal is present, never a guarantee — nothing
// for steps. Two lines resolved to the same canon item are the same ingredient
// whatever their wording, so they pair outright with no threshold involved.
// Applied ONLY when the key is unambiguous — exactly one still-unpaired item on
// each side carries it — because two lines sharing a canon item inside one
// recipe say nothing about which pairs with which. An ambiguous key falls
// through to Pass 4.
//
// Pass 4 — fuzzy content. Word-set Jaccard, chosen over edit distance because
// recipe rewording is word-level (words inserted/removed/swapped), not character
// typos, and over LCS (`diffWords`) because a reword reorders the phrase: LCS
// scores 0.000 on the measured garlic pair below. Scoring drops bare numerals,
// measurement words and size filler first, so metricating a quantity — the
// commonest house-rules edit, and the one that produced this defect — stops
// diluting the score: `1 small clove of garlic, grated or minced` → `3 g garlic
// (about 1 small clove), grated` pairs comfortably once normalised (see the test
// for the exact figure). When normalisation would empty a side ("1 large"), the
// raw token sets are scored instead — so an item made entirely of quantity words
// is still comparable rather than silently unpairable. Normalisation does lower
// some scores, and is meant to: "200 g flour" vs "200 g sugar" drops 0.5 → 0,
// which is the point.
//
// Normalisation can also SHRINK the identity set enough that plain Jaccard
// under-scores the commonest reword of all — appending a preparation phrase to a
// short line. `1 large onion` → `1 large onion, thinly sliced` leaves the
// existing side's identity set as just {onion}; Jaccard against the 3-word draft
// set scores 0.333, below threshold — a real regression Jaccard alone cannot
// avoid, because a short identity set loses proportionally more of itself for
// every word the other side gains. When one side's identity set is a SUBSET of
// the other's — a description was added, nothing swapped — the score uses the
// Sørensen–Dice coefficient instead (2·|A∩B| / (|A|+|B|), which weights the
// shared words more heavily than Jaccard's union does) and the onion pair clears
// the threshold. A pair with no containment relationship either way (`hot smoked
// paprika` vs `hot smoked salmon fillet`) never enters this branch and stays on
// plain Jaccard, so the existing split is untouched.
//
// The assignment is GLOBAL, not greedy in document order: a maximum-cardinality
// matching over the pairs clearing the threshold, so a draft item arriving first
// can no longer consume the partner a later one needed more.
//
// FUZZY_MATCH_THRESHOLD is deliberately high and is NOT the knob to turn. This is
// an approval gate, so a FALSE pairing (labelling a genuinely-new item and a
// genuinely-deleted item as one edit) actively misleads the reviewer and is worse
// than an honest add + remove. 0.5 means the pair shares at least as many
// identity words as it differs by: "salt" vs "pepper" scores 0 (stays
// add + remove); "120ml hot water" vs "120ml water" scores 0.67 (pairs).
//
// BOUNDARY — what this does NOT do (CLAUDE.md rule 12), each pinned in
// diffRecipe.test.ts:
//   • It maximises the NUMBER of pairs, not their total score, and the result is
//     not provably optimal by weight. What IS guaranteed: an augmenting path may
//     only take an edge already held by another draft item when its own score is
//     AT LEAST AS STRONG as the edge it would displace (`maximiseMatching`'s
//     `assignedScore` gate) — so cardinality-maximising can no longer break apart
//     a strictly stronger pair to manufacture a second, weaker one. Ties can
//     still be resolved either way, and the total is not maximised by weight.
//   • Word-set overlap cannot separate every reword from every coincidence.
//     `1 small red onion or a couple of shallots` → `150 g red onion, finely
//     sliced` scores 0.400 on normalised tokens — IDENTICALLY to the
//     paprika/salmon non-pair the threshold exists to split. No threshold and no
//     symmetric word-set metric (Jaccard, Dice, containment) can resolve it; only
//     Pass 3 can, and only when both lines resolved to the same canon item.
//   • Passes 3 and 4 pair across ingredient groups — the groups are flattened
//     before matching, so an item in "For the sauce" can pair with one in "For
//     the dough". Out of scope here; tracked on #824.
const FUZZY_MATCH_THRESHOLD = 0.5;

// Words that carry quantity or measure rather than identity. Deliberately short:
// each entry has to be noise in EVERY recipe, not just in the sample that
// motivated it. `clove` is a notable omission — dropping it would collapse
// "ground cloves" and "ground cinnamon" onto a 0.5 false pairing, and the garlic
// case above already pairs without it.
const MEASUREMENT_WORDS = new Set([
  'g',
  'kg',
  'mg',
  'ml',
  'cl',
  'dl',
  'l',
  'gram',
  'grams',
  'gramme',
  'grammes',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'litre',
  'litres',
  'liter',
  'liters',
  'millilitre',
  'millilitres',
  'milliliter',
  'milliliters',
  'tsp',
  'tsps',
  'tbsp',
  'tbsps',
  'teaspoon',
  'teaspoons',
  'tablespoon',
  'tablespoons',
  'oz',
  'lb',
  'lbs',
  'ounce',
  'ounces',
  'pound',
  'pounds',
  'cup',
  'cups',
  'sec',
  'secs',
  'second',
  'seconds',
  'min',
  'mins',
  'minute',
  'minutes',
  'hr',
  'hrs',
  'hour',
  'hours',
]);

// Size adjectives and grammatical filler. Same bar: noise everywhere, never the
// thing being named.
const FILLER_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'or',
  'and',
  'about',
  'approx',
  'couple',
  'small',
  'medium',
  'large',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Drop the tokens that describe how much rather than what. A bare numeral only:
// `120ml` stays one token (the split above breaks on punctuation, not on a
// digit/letter boundary) and is left alone, so it still contributes to a pair
// like "120ml hot water" → "120ml water".
function isMeasureNoise(token: string): boolean {
  return /^\p{N}+$/u.test(token) || MEASUREMENT_WORDS.has(token) || FILLER_WORDS.has(token);
}

// Shared intersection count, used by both jaccard and dice below.
function intersectionSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

// Word-set Jaccard: |A ∩ B| / |A ∪ B|, in [0, 1].
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const intersection = intersectionSize(a, b);
  return intersection / (a.size + b.size - intersection);
}

// Sørensen–Dice: 2·|A ∩ B| / (|A| + |B|), in [0, 1]. Always >= Jaccard for the
// same pair — used only for the containment case below, where Jaccard
// under-scores a short set for no longer having a matching number of words.
function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  return (2 * intersectionSize(a, b)) / (a.size + b.size);
}

// True when every token of `small` is present in `big` (small.size may equal
// big.size — an equal pair is a degenerate containment both ways).
function isSubsetOf(small: ReadonlySet<string>, big: ReadonlySet<string>): boolean {
  for (const token of small) {
    if (!big.has(token)) return false;
  }
  return true;
}

// Similarity over identity words, falling back to the raw word sets when
// normalisation would empty a side. An empty side scores 0 (never a match — an
// all-punctuation or empty item can't be "clearly the same" as another).
//
// When one side's identity set is a SUBSET of the other's, score by Dice
// instead of Jaccard (see the Pass 4 header above) — Jaccard punishes a short
// existing line for every word a genuine addition brings in, which is exactly
// backwards when none of the existing line's words were removed.
function contentSimilarity(a: string, b: string): number {
  const aRaw = new Set(tokenize(a));
  const bRaw = new Set(tokenize(b));
  if (aRaw.size === 0 || bRaw.size === 0) return 0;
  const aIdentity = new Set([...aRaw].filter((token) => !isMeasureNoise(token)));
  const bIdentity = new Set([...bRaw].filter((token) => !isMeasureNoise(token)));
  if (aIdentity.size === 0 || bIdentity.size === 0) return jaccard(aRaw, bRaw);
  if (isSubsetOf(aIdentity, bIdentity) || isSubsetOf(bIdentity, aIdentity)) {
    return dice(aIdentity, bIdentity);
  }
  return jaccard(aIdentity, bIdentity);
}

interface CandidateEdge {
  index: number;
  score: number;
}

// Cardinality-maximising bipartite matching (Kuhn's augmenting-path search)
// over `candidates[draftIndex] = { index: existingIndex, score }[]`. Returns
// existingIndex → draftIndex, -1 for unmatched. Deterministic: the caller
// fixes both the order draft items are offered in and the order of each
// item's candidate list.
//
// An augmenting path may re-route an existing pairing to free up an edge for
// a new draft item — that is how cardinality gets maximised — but it may only
// do so when the new edge's score is AT LEAST AS STRONG as the one it would
// take from the item already holding it (`assignedScore` below). Without this
// gate the search can strip a draft item of its single strongest edge to
// manufacture two weaker pairs elsewhere, reporting a confident but wrong
// attribution — see diffRecipe.test.ts's "does not misattribute a strong pair"
// case (#1137 review B1). The gate cannot be fooled by chained reassignment:
// it is re-checked at every recursion depth, against whatever score currently
// occupies the contested slot at that moment.
function maximiseMatching(candidates: readonly CandidateEdge[][], existingCount: number): number[] {
  const assignedTo = new Array<number>(existingCount).fill(-1);
  const assignedScore = new Array<number>(existingCount).fill(-Infinity);
  // Both index reads below are in range by construction — `draftIndex` walks
  // `candidates`, and every `existingIndex` came out of a candidate list the
  // caller built from `fuzzyExisting.map((_, index) => …)`.
  const augment = (draftIndex: number, visited: boolean[]): boolean => {
    for (const edge of candidates[draftIndex]!) {
      const existingIndex = edge.index;
      if (visited[existingIndex]) continue;
      visited[existingIndex] = true;
      const holder = assignedTo[existingIndex]!;
      if (holder !== -1 && edge.score < assignedScore[existingIndex]!) continue;
      if (holder === -1 || augment(holder, visited)) {
        assignedTo[existingIndex] = draftIndex;
        assignedScore[existingIndex] = edge.score;
        return true;
      }
    }
    return false;
  };
  // Best-scoring draft item first (the caller pre-sorted `order`), so the
  // strongest pairs are taken before the search starts rearranging around them.
  for (let i = 0; i < candidates.length; i++) {
    augment(i, new Array<boolean>(existingCount).fill(false));
  }
  return assignedTo;
}

// Match two lists by `id`, then reconcile the leftovers by a content key, an
// exact identity key, and finally content similarity. Deterministic: the summary
// is item-level, so document order only feeds the reported `position` and the
// tie-breaks, never identity itself.
function matchByIdThenContent<T extends { id: string }>(
  existing: readonly T[],
  draft: readonly T[],
  contentKey: (item: T) => string,
  identityKey: (item: T) => string | null = () => null,
): MatchResult<T> {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const matched: Array<Match<T>> = [];
  const consumedExistingIds = new Set<string>();
  const unmatchedDraft: T[] = [];

  for (const draftItem of draft) {
    const existingItem = existingById.get(draftItem.id);
    if (existingItem && !consumedExistingIds.has(existingItem.id)) {
      matched.push({ existing: existingItem, draft: draftItem });
      consumedExistingIds.add(existingItem.id);
    } else {
      unmatchedDraft.push(draftItem);
    }
  }

  // Pass 2: pair remaining draft items with remaining existing items by exact content.
  const remainingByContent = new Map<string, T[]>();
  const unmatchedExisting = existing.filter((item) => !consumedExistingIds.has(item.id));
  for (const item of unmatchedExisting) {
    const key = contentKey(item);
    const bucket = remainingByContent.get(key);
    if (bucket) bucket.push(item);
    else remainingByContent.set(key, [item]);
  }

  const leftoverDraft: T[] = [];
  const consumedExisting = new Set<T>();
  for (const draftItem of unmatchedDraft) {
    const bucket = remainingByContent.get(contentKey(draftItem));
    const existingItem = bucket?.shift();
    if (existingItem) {
      matched.push({ existing: existingItem, draft: draftItem });
      consumedExisting.add(existingItem);
    } else {
      leftoverDraft.push(draftItem);
    }
  }

  // Pass 3: exact non-content identity — a shared canon item for ingredients,
  // nothing for steps. Only an UNAMBIGUOUS key pairs: exactly one still-unpaired
  // item on each side carries it. Insertion-ordered maps keep this deterministic.
  const leftoverExisting = unmatchedExisting.filter((item) => !consumedExisting.has(item));
  const bucketByIdentity = (items: readonly T[]): Map<string, T[]> => {
    const buckets = new Map<string, T[]>();
    for (const item of items) {
      const key = identityKey(item);
      if (key === null) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    return buckets;
  };
  const existingByIdentity = bucketByIdentity(leftoverExisting);
  const identityConsumed = new Set<T>();
  for (const [key, drafts] of bucketByIdentity(leftoverDraft)) {
    if (drafts.length !== 1) continue;
    const existingCandidates = existingByIdentity.get(key);
    if (existingCandidates?.length !== 1) continue;
    matched.push({ existing: existingCandidates[0]!, draft: drafts[0]! });
    identityConsumed.add(existingCandidates[0]!);
    identityConsumed.add(drafts[0]!);
  }

  // Pass 4: fuzzy content match. A survivor here matched no id (Pass 1), no exact
  // content (Pass 2) and no canon item (Pass 3) — the reworded-with-fresh-id case.
  // A pure reorder never reaches here (Pass 2 consumes it), so it cannot be
  // resurrected as a spurious change.
  const fuzzyDraft = leftoverDraft.filter((item) => !identityConsumed.has(item));
  const fuzzyExisting = leftoverExisting.filter((item) => !identityConsumed.has(item));

  // Candidate edges, per draft item: every existing item clearing the threshold,
  // strongest first, ties by document order.
  const scored = fuzzyDraft.map((draftItem) => {
    const draftKey = contentKey(draftItem);
    return fuzzyExisting
      .map((candidate, index) => ({
        index,
        score: contentSimilarity(contentKey(candidate), draftKey),
      }))
      .filter((edge) => edge.score >= FUZZY_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  });
  // Offer the draft items strongest-pair-first, ties by document order, so a
  // confident pairing is made before the search rearranges anything around it.
  const order = scored
    .map((edges, index) => ({ index, best: edges[0]?.score ?? -1 }))
    .sort((a, b) => b.best - a.best || a.index - b.index)
    .map((entry) => entry.index);
  const assignedTo = maximiseMatching(
    order.map((draftIndex) => scored[draftIndex]!),
    fuzzyExisting.length,
  );

  // assignedTo is indexed by existing item and holds a position in `order`.
  const partnerOfDraft = new Map<number, number>();
  assignedTo.forEach((orderPosition, existingIndex) => {
    if (orderPosition !== -1) partnerOfDraft.set(order[orderPosition]!, existingIndex);
  });

  const added: T[] = [];
  const fuzzyConsumed = new Set<T>();
  fuzzyDraft.forEach((draftItem, draftIndex) => {
    const existingIndex = partnerOfDraft.get(draftIndex);
    if (existingIndex === undefined) {
      added.push(draftItem);
      return;
    }
    const existingItem = fuzzyExisting[existingIndex]!;
    matched.push({ existing: existingItem, draft: draftItem });
    fuzzyConsumed.add(existingItem);
  });

  const removed = leftoverExisting.filter(
    (item) => !identityConsumed.has(item) && !fuzzyConsumed.has(item),
  );
  return { matched, added, removed };
}

function stringChange(from: string, to: string): RecipeFieldChange | undefined {
  return from === to ? undefined : { from, to };
}

function nullableStringChange(
  from: string | null,
  to: string | null,
): NullableStringChange | undefined {
  return from === to ? undefined : { from, to };
}

function numberChange(from: number | null, to: number | null): NullableNumberChange | undefined {
  return from === to ? undefined : { from, to };
}

function timersEqual(a: StepTimer | null, b: StepTimer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.durationMinutes === b.durationMinutes && a.description === b.description;
}

function flatIngredients(recipe: Recipe): Ingredient[] {
  return recipe.ingredients.flatMap((group) => group.items);
}

// Two phases are the same phase when all three of their fields match. `label` is
// compared as a VALUE, never read for meaning — nothing anywhere may branch on
// the word (the discipline CLAUDE.md applies to `recipes.kind`).
function phasesEqual(a: RecipePhase, b: RecipePhase): boolean {
  return (
    a.label === b.label &&
    a.handsOnMinutes === b.handsOnMinutes &&
    a.handsOffMinutes === b.handsOffMinutes
  );
}

// Position-wise, so a REORDER is a change (see `RecipePhasesChange`). `undefined`
// and `[]` are the same "no strip", so a recipe that never had one and one whose
// strip was cleared do not diff against each other.
function phasesChange(
  from: RecipePhase[] | undefined,
  to: RecipePhase[] | undefined,
): RecipePhasesChange | undefined {
  const a = from ?? [];
  const b = to ?? [];
  const same = a.length === b.length && a.every((phase, i) => phasesEqual(phase, b[i]!));
  return same ? undefined : { from: a, to: b };
}

function diffMetadata(existing: Recipe, draft: Recipe): RecipeMetadataDiff {
  const e = existing.metadata;
  const d = draft.metadata;
  const metadata: RecipeMetadataDiff = {};
  const servings = numberChange(e.servings, d.servings);
  if (servings) metadata.servings = servings;
  // The phase strip and its sentence (issue #1212), and since issue #1213 the
  // whole of what this reports about timing — `prepTimeMinutes`,
  // `cookTimeMinutes` and `totalTimeMinutes` are no longer reported at all, so
  // this is the only place the review gate can see that a proposal rewrote the
  // timing — or, since #1203 let an amend clear it, that it deleted the sentence.
  const phases = phasesChange(e.phases, d.phases);
  if (phases) metadata.phases = phases;
  const summary = nullableStringChange(e.timingSummary ?? null, d.timingSummary ?? null);
  if (summary) metadata.timingSummary = summary;
  return metadata;
}

export function diffRecipe(existing: Recipe, draft: Recipe): RecipeDiff {
  // ── Scalar fields ──────────────────────────────────────────────────────────
  const title = stringChange(existing.title, draft.title);
  const description = nullableStringChange(existing.description, draft.description);
  const notes = nullableStringChange(existing.notes, draft.notes);

  // ── Ingredients (flattened across groups; identity = rawText) ───────────────
  const existingIngredients = flatIngredients(existing);
  const draftIngredients = flatIngredients(draft);
  // `canonId` is machine-derived and therefore never RENDERED (see recipeDiff.ts),
  // but it is the strongest identity evidence available here: two lines resolved
  // to the same canon item are the same ingredient however they are worded.
  const ingredientMatch = matchByIdThenContent(
    existingIngredients,
    draftIngredients,
    (item) => item.rawText,
    (item) => item.canonId,
  );
  const ingredientsAdded: IngredientDiffEntry[] = ingredientMatch.added.map((item) => ({
    id: item.id,
    rawText: item.rawText,
  }));
  const ingredientsRemoved: IngredientDiffEntry[] = ingredientMatch.removed.map((item) => ({
    id: item.id,
    rawText: item.rawText,
  }));
  const ingredientsChanged: IngredientChange[] = [];
  for (const { existing: e, draft: d } of ingredientMatch.matched) {
    if (e.rawText !== d.rawText) {
      ingredientsChanged.push({ id: d.id, from: e.rawText, to: d.rawText });
    }
  }

  // ── Steps (identity = text; position is 1-based) ────────────────────────────
  const existingStepIndex = new Map<Step, number>(existing.steps.map((s, i) => [s, i]));
  const draftStepIndex = new Map<Step, number>(draft.steps.map((s, i) => [s, i]));
  const stepMatch = matchByIdThenContent(existing.steps, draft.steps, (item) => item.text);
  const stepsAdded: StepDiffEntry[] = stepMatch.added.map((step) => ({
    id: step.id,
    position: (draftStepIndex.get(step) ?? 0) + 1,
    text: step.text,
  }));
  const stepsRemoved: StepDiffEntry[] = stepMatch.removed.map((step) => ({
    id: step.id,
    position: (existingStepIndex.get(step) ?? 0) + 1,
    text: step.text,
  }));
  const stepsChanged: StepChange[] = [];
  for (const { existing: e, draft: d } of stepMatch.matched) {
    const textChange = stringChange(e.text, d.text);
    const noteChange = nullableStringChange(e.note, d.note);
    const timerChanged = !timersEqual(e.timer, d.timer);
    if (textChange || noteChange || timerChanged) {
      const change: StepChange = {
        id: d.id,
        position: (draftStepIndex.get(d) ?? 0) + 1,
      };
      if (textChange) change.text = textChange;
      if (timerChanged) change.timer = { from: e.timer, to: d.timer };
      if (noteChange) change.note = noteChange;
      stepsChanged.push(change);
    }
  }

  // ── Metadata + tags ─────────────────────────────────────────────────────────
  const metadata = diffMetadata(existing, draft);
  const existingTags = new Set(existing.metadata.tags);
  const draftTags = new Set(draft.metadata.tags);
  const tagsAdded = draft.metadata.tags.filter((tag) => !existingTags.has(tag));
  const tagsRemoved = existing.metadata.tags.filter((tag) => !draftTags.has(tag));

  const hasChanges =
    title !== undefined ||
    description !== undefined ||
    notes !== undefined ||
    ingredientsAdded.length > 0 ||
    ingredientsRemoved.length > 0 ||
    ingredientsChanged.length > 0 ||
    stepsAdded.length > 0 ||
    stepsRemoved.length > 0 ||
    stepsChanged.length > 0 ||
    Object.keys(metadata).length > 0 ||
    tagsAdded.length > 0 ||
    tagsRemoved.length > 0;

  const diff: RecipeDiff = {
    hasChanges,
    ingredients: {
      added: ingredientsAdded,
      removed: ingredientsRemoved,
      changed: ingredientsChanged,
    },
    steps: {
      added: stepsAdded,
      removed: stepsRemoved,
      changed: stepsChanged,
    },
    metadata,
    tags: { added: tagsAdded, removed: tagsRemoved },
  };
  if (title) diff.title = title;
  if (description) diff.description = description;
  if (notes) diff.notes = notes;
  return diff;
}
