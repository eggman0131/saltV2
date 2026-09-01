import type { Recipe } from '../entities/Recipe.js';
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
// `canonId` for ingredients (every ingredient in an amendment draft carries a
// resolved one), nothing for steps. Two lines resolved to the same canon item are
// the same ingredient whatever their wording, so they pair outright with no
// threshold involved. Applied ONLY when the key is unambiguous — exactly one
// still-unpaired item on each side carries it — because two lines sharing a canon
// item inside one recipe say nothing about which pairs with which. An ambiguous
// key falls through to Pass 4.
//
// Pass 4 — fuzzy content. Word-set Jaccard, chosen over edit distance because
// recipe rewording is word-level (words inserted/removed/swapped), not character
// typos, and over LCS (`diffWords`) because a reword reorders the phrase: LCS
// scores 0.000 on the measured garlic pair below. Scoring drops bare numerals,
// measurement words and size filler first, so metricating a quantity — the
// commonest house-rules edit, and the one that produced this defect — stops
// diluting the score: `1 small clove of garlic, grated or minced` → `3 g garlic
// (about 1 small clove), grated` goes from 0.455 (split) to 0.750 (paired). When
// normalisation would empty a side ("1 large"), the raw token sets are scored
// instead — so an item made entirely of quantity words is still comparable
// rather than silently unpairable. Normalisation does lower some scores, and is
// meant to: "200 g flour" vs "200 g sugar" drops 0.5 → 0, which is the point.
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
//   • It maximises the NUMBER of pairs, not their total score. Draft items are
//     offered in descending best-score order so a strong pair is preferred among
//     the maximum-cardinality assignments, but the result is not provably optimal
//     by weight.
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

// Word-set Jaccard: |A ∩ B| / |A ∪ B|, in [0, 1].
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

// Similarity over identity words, falling back to the raw word sets when
// normalisation would empty a side. An empty side scores 0 (never a match — an
// all-punctuation or empty item can't be "clearly the same" as another).
function contentSimilarity(a: string, b: string): number {
  const aRaw = new Set(tokenize(a));
  const bRaw = new Set(tokenize(b));
  if (aRaw.size === 0 || bRaw.size === 0) return 0;
  const aIdentity = new Set([...aRaw].filter((token) => !isMeasureNoise(token)));
  const bIdentity = new Set([...bRaw].filter((token) => !isMeasureNoise(token)));
  if (aIdentity.size === 0 || bIdentity.size === 0) return jaccard(aRaw, bRaw);
  return jaccard(aIdentity, bIdentity);
}

// Maximum-cardinality bipartite matching (Kuhn's augmenting-path search) over
// `candidates[draftIndex] = existingIndex[]`. Returns existingIndex → draftIndex,
// -1 for unmatched. Deterministic: the caller fixes both the order draft items
// are offered in and the order of each item's candidate list.
function maximiseMatching(candidates: readonly number[][], existingCount: number): number[] {
  const assignedTo = new Array<number>(existingCount).fill(-1);
  const augment = (draftIndex: number, visited: boolean[]): boolean => {
    for (const existingIndex of candidates[draftIndex] ?? []) {
      if (visited[existingIndex]) continue;
      visited[existingIndex] = true;
      const holder = assignedTo[existingIndex];
      if (holder === undefined || holder === -1 || augment(holder, visited)) {
        assignedTo[existingIndex] = draftIndex;
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
    order.map((draftIndex) => scored[draftIndex]!.map((edge) => edge.index)),
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

function diffMetadata(existing: Recipe, draft: Recipe): RecipeMetadataDiff {
  const e = existing.metadata;
  const d = draft.metadata;
  const metadata: RecipeMetadataDiff = {};
  const servings = numberChange(e.servings, d.servings);
  if (servings) metadata.servings = servings;
  const total = numberChange(e.totalTimeMinutes, d.totalTimeMinutes);
  if (total) metadata.totalTimeMinutes = total;
  const prep = numberChange(e.prepTimeMinutes, d.prepTimeMinutes);
  if (prep) metadata.prepTimeMinutes = prep;
  const cook = numberChange(e.cookTimeMinutes, d.cookTimeMinutes);
  if (cook) metadata.cookTimeMinutes = cook;
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
