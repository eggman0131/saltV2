import {
  subscribeRecipes,
  saveRecipe as saveRecipeDoc,
  deleteRecipe as deleteRecipeDoc,
  callParseRecipeIngredients,
  callCanonicaliseRecipeIngredients,
  saveShoppingListItem,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import { addItem } from '@salt/domain';
import type { Recipe, IngredientGroup, Quantity, SourceRef } from '@salt/domain';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Recipe service (issue #179, Phase 2). An optimistic store over the Phase 1
// firebase-sync adapter: the whole `recipes` collection is subscribed once and
// held in memory; saves/deletes update the store immediately and persist the
// whole document (whole-document LWW on `updatedAt`). See docs/recipe-module.md.

// ─── Reactive stores ──────────────────────────────────────────────────────────

const _recipes = writable<readonly Recipe[]>([]);
export const recipes: Readable<readonly Recipe[]> = _recipes;

const _isLoadingRecipes = writable(true);
export const isLoadingRecipes: Readable<boolean> = _isLoadingRecipes;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createLDErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createLDErrorReportingAdapter();
  return _errorReporter;
}

// ─── Snapshot guard ─────────────────────────────────────────────────────────────
// Newest `updatedAt` we've applied locally per recipe id (from an optimistic
// write or an accepted snapshot). Guards against an in-flight stale snapshot
// echo landing after a newer local edit and reverting it — same pattern as the
// other optimistic stores. A local delete records `now` so a stale echo that
// still contains the doc can't resurrect it.
const latestLocalEdit = new Map<string, string>();

function applySnapshot(incoming: Recipe[]): void {
  const currentById = new Map(get(_recipes).map((r) => [r.id, r]));
  const result: Recipe[] = [];
  const seen = new Set<string>();
  for (const r of incoming) {
    seen.add(r.id);
    const local = latestLocalEdit.get(r.id);
    if (local !== undefined && r.updatedAt < local) {
      // Stale echo: prefer our newer optimistic copy; if we deleted it locally
      // (no current copy), drop it rather than resurrecting the old doc.
      const ours = currentById.get(r.id);
      if (ours) result.push(ours);
      continue;
    }
    if (r.updatedAt) latestLocalEdit.set(r.id, r.updatedAt);
    result.push(r);
  }
  // Keep optimistic creates not yet echoed by the snapshot.
  for (const [id, r] of currentById) {
    if (!seen.has(id) && latestLocalEdit.has(id)) result.push(r);
  }
  _recipes.set(result);
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

export function initRecipeSync(): () => void {
  _isLoadingRecipes.set(true);
  const errors = getErrorReporter();
  const unsub = subscribeRecipes(
    (incoming) => {
      applySnapshot(incoming);
      _isLoadingRecipes.set(false);
    },
    (err) => {
      errors.report(err);
      _isLoadingRecipes.set(false);
    },
  );
  return unsub;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Stamp updatedAt, update the store optimistically, then persist the whole doc.
export async function persistRecipe(recipe: Recipe): Promise<ReadResult<void, DomainError>> {
  const stamped: Recipe = { ...recipe, updatedAt: new Date().toISOString() };
  latestLocalEdit.set(stamped.id, stamped.updatedAt);
  const others = get(_recipes).filter((r) => r.id !== stamped.id);
  _recipes.set([...others, stamped]);
  return saveRecipeDoc(stamped);
}

export async function parseIngredients(
  rawText: string,
): Promise<ReadResult<IngredientGroup[], DomainError>> {
  return callParseRecipeIngredients(rawText);
}

// Canonicalise all parsed-but-unmatched ingredients in a recipe via a single
// batch CF call. Only processes ingredients with parsed !== null and matchState
// 'pending' or 'failed'. Results are applied wholesale via persistRecipe.
export async function canonicaliseIngredients(
  recipe: Recipe,
): Promise<ReadResult<void, DomainError>> {
  // Collect ingredients that need canonicalisation: parsed and not yet matched.
  const toProcess: Array<{ ingredientId: string; rawName: string; rawText: string }> = [];
  for (const group of recipe.ingredients) {
    for (const ing of group.items) {
      if (ing.parsed !== null && (ing.matchState === 'pending' || ing.matchState === 'failed')) {
        toProcess.push({ ingredientId: ing.id, rawName: ing.parsed.item, rawText: ing.rawText });
      }
    }
  }

  if (toProcess.length === 0) return success(undefined);

  const batchResult = await callCanonicaliseRecipeIngredients({
    items: toProcess.map(({ rawName, rawText }) => ({ rawName, rawText })),
  });
  if (batchResult.kind === 'err') return batchResult;
  const settled = batchResult.value;

  // Map ingredientId → matchOrCreate result for O(1) lookup.
  const resultById = new Map(
    toProcess.map((p, i) => {
      const r = settled[i];
      return [p.ingredientId, r] as const;
    }),
  );

  const updatedGroups = recipe.ingredients.map((group) => ({
    ...group,
    items: group.items.map((ing) => {
      const result = resultById.get(ing.id);
      if (result === undefined) return ing;
      if (result.kind === 'err') {
        return { ...ing, matchState: 'failed' as const, canonId: null };
      }
      return {
        ...ing,
        canonId: result.value.item.id,
        matchState: 'matched' as const,
      };
    }),
  }));

  return persistRecipe({ ...recipe, ingredients: updatedGroups });
}

export async function removeRecipe(id: string): Promise<ReadResult<void, DomainError>> {
  // Record the delete as a local edit so a stale echo can't resurrect the doc.
  latestLocalEdit.set(id, new Date().toISOString());
  _recipes.set(get(_recipes).filter((r) => r.id !== id));
  return deleteRecipeDoc(id);
}

// ─── Shopping-list extraction ─────────────────────────────────────────────────

function quantityToNumber(q: Quantity): number {
  if (q.type === 'single') return q.value;
  if (q.type === 'range') return q.min;
  return q.whole + q.numerator / q.denominator;
}

const _itemIds = { newListId: () => crypto.randomUUID(), newItemId: () => crypto.randomUUID() };

// Push all canonicalised (and unmatched) ingredients from a recipe into a
// shopping list. Matched ingredients carry convertedWeight (g/ml) scaled by
// servings; falls back to parsed.quantity / parsed.unit when convertedWeight is
// null. Unmatched items are added as rawText entries so nothing is silently
// dropped.
export async function addRecipeToShoppingList(
  recipe: Recipe,
  listId: string,
  servings: number,
): Promise<ReadResult<void, DomainError>> {
  const now = new Date().toISOString();
  const baseServings = recipe.metadata.servings ?? 1;
  const scale = servings / baseServings;

  const source: SourceRef = {
    kind: 'recipe',
    recipeId: recipe.id,
    servings,
    label: recipe.title,
  };

  const saves: Promise<ReadResult<void, DomainError>>[] = [];

  for (const group of recipe.ingredients) {
    for (const ing of group.items) {
      const isMatched = ing.matchState === 'matched' && ing.canonId !== null;

      let amount: number | undefined;
      let unit: string | undefined;

      if (isMatched && ing.parsed !== null) {
        if (ing.parsed.convertedWeight !== null) {
          amount = Math.round(ing.parsed.convertedWeight.value * scale * 10) / 10;
          unit = ing.parsed.convertedWeight.unit;
        } else if (ing.parsed.quantity !== null) {
          amount = Math.round(quantityToNumber(ing.parsed.quantity) * scale * 100) / 100;
          unit = ing.parsed.unit ?? undefined;
        }
      }

      const result = addItem(
        [],
        {
          rawText: ing.rawText,
          source,
          now,
          ...(isMatched ? { canonId: ing.canonId, matchState: 'matched' as const } : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(unit !== undefined ? { unit } : {}),
        },
        _itemIds,
      );

      if (result.kind !== 'ok') return result;
      saves.push(saveShoppingListItem(listId, result.value[0]!));
    }
  }

  if (saves.length === 0) return success(undefined);

  const results = await Promise.all(saves);
  return results.find((r) => r.kind !== 'ok') ?? success(undefined);
}
