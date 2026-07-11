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
} from '../../schemas/recipeDiff.js';

// Pure recipe diff (Phase 1). Compares an `existing` recipe with an edited `draft`
// and reports only human-signal changes so a client can render a section-grouped
// summary. Domain purity: no I/O, no store, no dates — the caller supplies both
// recipes. Machine-derived fields are ignored (see recipeDiff.ts).
//
// Item identity (ingredients + steps): match by stable `id` first (the recipe
// flow preserves ids for unedited items), then fall back to content equality
// (`rawText`/`text`) for a still-unmatched pair. That fallback keeps a genuinely
// unchanged item — whose id happened to change — from showing as a spurious
// remove+add, while a REUSED id with different content reads as an edit. A pure
// reorder with no content change matches on both passes and is therefore omitted.

interface Match<T> {
  existing: T;
  draft: T;
}

interface MatchResult<T> {
  matched: Array<Match<T>>;
  added: T[];
  removed: T[];
}

// Match two lists by `id`, then reconcile the leftovers by a content key. Stable
// and order-independent: the summary is item-level, so document order only feeds
// the reported `position`, never identity.
function matchByIdThenContent<T extends { id: string }>(
  existing: readonly T[],
  draft: readonly T[],
  contentKey: (item: T) => string,
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

  // Fallback: pair remaining draft items with remaining existing items by content.
  const remainingByContent = new Map<string, T[]>();
  const unmatchedExisting = existing.filter((item) => !consumedExistingIds.has(item.id));
  for (const item of unmatchedExisting) {
    const key = contentKey(item);
    const bucket = remainingByContent.get(key);
    if (bucket) bucket.push(item);
    else remainingByContent.set(key, [item]);
  }

  const added: T[] = [];
  const consumedExisting = new Set<T>();
  for (const draftItem of unmatchedDraft) {
    const bucket = remainingByContent.get(contentKey(draftItem));
    const existingItem = bucket?.shift();
    if (existingItem) {
      matched.push({ existing: existingItem, draft: draftItem });
      consumedExisting.add(existingItem);
    } else {
      added.push(draftItem);
    }
  }

  const removed = unmatchedExisting.filter((item) => !consumedExisting.has(item));
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
  const ingredientMatch = matchByIdThenContent(
    existingIngredients,
    draftIngredients,
    (item) => item.rawText,
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
