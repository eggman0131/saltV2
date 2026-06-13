import {
  subscribeRecipes,
  saveRecipe as saveRecipeDoc,
  deleteRecipe as deleteRecipeDoc,
  callParseRecipeIngredients,
  callCanonicaliseRecipeIngredients,
  saveShoppingListItem,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import { addItem, recipeItemAddDefault } from '@salt/domain';
import type {
  Recipe,
  Ingredient,
  IngredientGroup,
  Quantity,
  SourceRef,
  CanonItem,
} from '@salt/domain';
import { hasLiveCanonMatch } from '@salt/domain';
import { success, type DomainError, type ReadResult } from '@salt/shared-types';
import { getCanonItemsSnapshot } from './canonService.js';
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
  // Collect ingredients that need canonicalisation: parsed and without a live match
  // (pending, failed, or matched-but-canon-item-deleted).
  const canonIds = new Set(getCanonItemsSnapshot().map((c) => c.id));
  const toProcess: Array<{ ingredientId: string; rawName: string; rawText: string }> = [];
  for (const group of recipe.ingredients) {
    for (const ing of group.items) {
      if (ing.parsed !== null && !hasLiveCanonMatch(ing, canonIds)) {
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

// Parse and canon-match a single ingredient line. Chains callParseRecipeIngredients
// → callCanonicaliseRecipeIngredients (batch-of-one) and folds the result into the
// ingredient. Operates on the in-memory draft; the caller must persist the result.
export async function matchIngredient(
  ing: Ingredient,
): Promise<ReadResult<Ingredient, DomainError>> {
  const parseResult = await callParseRecipeIngredients(ing.rawText);
  if (parseResult.kind === 'err') return parseResult;

  const firstItem = parseResult.value[0]?.items[0];
  if (!firstItem?.parsed) {
    return success({ ...ing, parsed: null, canonId: null, matchState: 'failed' as const });
  }
  const parsed = firstItem.parsed;

  const canonResult = await callCanonicaliseRecipeIngredients({
    items: [{ rawName: parsed.item, rawText: ing.rawText }],
  });
  if (canonResult.kind === 'err') return canonResult;

  const slot = canonResult.value[0]!;
  if (slot.kind === 'err') {
    return success({ ...ing, parsed, canonId: null, matchState: 'failed' as const });
  }
  return success({
    ...ing,
    parsed,
    canonId: slot.value.item.id,
    matchState: 'matched' as const,
  });
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

// One ingredient row in the recipe-add review step (issue #185). Carries the
// scaled amount/unit and resolved canon match, the default Add/Check toggles
// (from the canon item's shoppingBehavior), and the current user-chosen toggles
// (seeded from the defaults, mutated by the review sheet). `commitRecipeAddPlan`
// writes only the rows the user left as `add: true`.
export interface RecipeAddRow {
  readonly ingredientId: string;
  readonly rawText: string;
  /** Canon name when live-matched, else the raw text — the label the sheet shows. */
  readonly name: string;
  readonly fromCanon: boolean;
  readonly isOptional: boolean;
  readonly canonId: string | null;
  readonly matched: boolean;
  readonly amount?: number;
  readonly unit?: string;
  add: boolean;
  check: boolean;
}

// Compute the scaled amount/unit for an ingredient. quantity is always in metric
// (g/ml) so no conversion needed — scale and round directly.
function scaledAmountUnit(ing: Ingredient, scale: number): { amount?: number; unit?: string } {
  if (ing.parsed === null || ing.parsed.quantity === null) return {};
  const amount = Math.round(quantityToNumber(ing.parsed.quantity) * scale * 10) / 10;
  return ing.parsed.unit !== null ? { amount, unit: ing.parsed.unit } : { amount };
}

// Build the review plan for adding a recipe to a list at the given servings.
// Every ingredient becomes a row with its scaled amount and a default Add/Check
// state driven by the matched canon item's shoppingBehavior (issue #185). The
// caller (review sheet) lets the user adjust the toggles, then hands the rows to
// commitRecipeAddPlan. Pure read against the canon snapshot — no writes here.
export function buildRecipeAddPlan(recipe: Recipe, servings: number): RecipeAddRow[] {
  const baseServings = recipe.metadata.servings ?? 1;
  const scale = servings / baseServings;
  const canonById = new Map<string, CanonItem>(getCanonItemsSnapshot().map((c) => [c.id, c]));
  const liveCanonIds = new Set(canonById.keys());

  const rows: RecipeAddRow[] = [];
  for (const group of recipe.ingredients) {
    for (const ing of group.items) {
      const matched = hasLiveCanonMatch(ing, liveCanonIds);
      const canon = matched ? (canonById.get(ing.canonId!) ?? null) : null;
      const { amount, unit } = matched ? scaledAmountUnit(ing, scale) : {};

      const dflt = recipeItemAddDefault(
        canon?.shoppingBehavior ?? null,
        amount ?? null,
        canon?.largeQuantityThreshold,
      );

      rows.push({
        ingredientId: ing.id,
        rawText: ing.rawText,
        name: canon?.name ?? ing.rawText,
        fromCanon: canon !== null,
        isOptional: ing.isOptional,
        canonId: matched ? ing.canonId : null,
        matched,
        ...(amount !== undefined ? { amount } : {}),
        ...(unit !== undefined ? { unit } : {}),
        add: dflt.add,
        check: dflt.check,
      });
    }
  }
  return rows;
}

// Write the user-confirmed rows of a recipe-add plan to the shopping list. Only
// rows left as `add: true` are written; `check: true` rows land flagged for
// verification (needsCheck). Matched rows carry their canonId + matchState and
// scaled amount/unit. One item per row — combining is display-time (Phase 3).
export async function commitRecipeAddPlan(
  recipe: Recipe,
  listId: string,
  servings: number,
  rows: readonly RecipeAddRow[],
): Promise<ReadResult<void, DomainError>> {
  const now = new Date().toISOString();
  const source: SourceRef = {
    kind: 'recipe',
    recipeId: recipe.id,
    servings,
    label: recipe.title,
  };

  const saves: Promise<ReadResult<void, DomainError>>[] = [];
  for (const row of rows) {
    if (!row.add) continue;
    const result = addItem(
      [],
      {
        rawText: row.rawText,
        source,
        now,
        needsCheck: row.check,
        ...(row.matched ? { canonId: row.canonId, matchState: 'matched' as const } : {}),
        ...(row.amount !== undefined ? { amount: row.amount } : {}),
        ...(row.unit !== undefined ? { unit: row.unit } : {}),
      },
      _itemIds,
    );
    if (result.kind !== 'ok') return result;
    saves.push(saveShoppingListItem(listId, result.value[0]!));
  }

  if (saves.length === 0) return success(undefined);

  const results = await Promise.all(saves);
  return results.find((r) => r.kind !== 'ok') ?? success(undefined);
}
