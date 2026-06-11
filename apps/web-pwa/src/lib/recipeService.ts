import {
  subscribeRecipes,
  saveRecipe as saveRecipeDoc,
  deleteRecipe as deleteRecipeDoc,
  callParseRecipeIngredients,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import type { Recipe, IngredientGroup } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
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

export async function removeRecipe(id: string): Promise<ReadResult<void, DomainError>> {
  // Record the delete as a local edit so a stale echo can't resurrect the doc.
  latestLocalEdit.set(id, new Date().toISOString());
  _recipes.set(get(_recipes).filter((r) => r.id !== id));
  return deleteRecipeDoc(id);
}
