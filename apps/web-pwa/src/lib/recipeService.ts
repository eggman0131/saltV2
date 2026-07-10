import {
  subscribeRecipes,
  saveRecipe as saveRecipeDoc,
  deleteRecipe as deleteRecipeDoc,
  callParseRecipeIngredients,
  callCanonicaliseRecipeIngredients,
  callExtractRecipeFromUrl,
  callAuthorRecipe,
  callRegenerateRecipeImage,
  saveShoppingListItem,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter, startUserActionSpan } from '@salt/observability';
import type { AuthorRecipeInput, RecipeDoc } from '@salt/domain/schemas';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';
import { addItem, recipeItemAddDefault, findProducingRecipes } from '@salt/domain';
import type {
  Recipe,
  Ingredient,
  IngredientGroup,
  Quantity,
  SourceRef,
  CanonItem,
} from '@salt/domain';
import type { UrlImportFailureCode } from '@salt/domain/schemas';
import { hasLiveCanonMatch } from '@salt/domain';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
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

// Synchronous snapshot of the recipes store. Used by the e2e bridge to assert
// the parsed/canonical ingredient structure that lives in the store but is only
// partially surfaced in the DOM. Mirrors getShoppingListItems / getCanonItem.
export function getRecipesSnapshot(): readonly Recipe[] {
  return get(_recipes);
}

const _isLoadingRecipes = writable(true);
export const isLoadingRecipes: Readable<boolean> = _isLoadingRecipes;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
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
    (err, rawError) => {
      reportSubscriptionError(errors, err, rawError);
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
  return reportIfFailed(getErrorReporter(), await saveRecipeDoc(stamped));
}

export async function parseIngredients(
  rawText: string,
): Promise<ReadResult<IngredientGroup[], DomainError>> {
  return callParseRecipeIngredients(rawText);
}

// ─── Hero image (issue #148, Tier-2) ────────────────────────────────────────────
// The photoreal hero is generated server-side by the onRecipeWritten trigger on
// create. These two commands are the manual controls.

// Regenerate (or first-time generate / un-hide) the hero via the auth-gated
// callable. The callable clears `image` + un-hides + bumps the nonce, re-firing
// the trigger; the new URL arrives via the recipe subscription. An optional
// `hint` is a one-shot additive steer. Deliberately a callable, not an optimistic
// store write — a client whole-document write would risk clobbering the trigger's
// image write (whole-document LWW).
export async function regenerateRecipeImage(
  recipeId: string,
  hint?: string,
): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await callRegenerateRecipeImage(recipeId, hint));
}

// Hide / show the hero. A plain optimistic recipe write (no server authority
// needed) that flips `imageHidden`; the existing `image` is preserved, so "show"
// brings the same photo straight back without regenerating.
export async function setRecipeImageHidden(
  recipe: Recipe,
  hidden: boolean,
): Promise<ReadResult<void, DomainError>> {
  return persistRecipe({ ...recipe, imageHidden: hidden });
}

// ─── URL import ────────────────────────────────────────────────────────────────
// SSRF-hardened import: paste a recipe URL, get back a fully-converted (metric +
// British) draft. The draft is NOT persisted here — the caller hydrates the
// editor with it so the user reviews/saves. On failure we return a specific,
// friendly message keyed off the import failure code; the UI shows it and lets
// the user fall back to manual/chat.

// User-facing copy per failure code. Mirrors the CF entrypoint's HttpsError
// messages but lives client-side so we never depend on the server message text.
const URL_IMPORT_COPY: Record<UrlImportFailureCode, string> = {
  'invalid-url': "That doesn't look like a valid web address.",
  'blocked-url': "That link can't be imported.",
  'fetch-failed': "We couldn't reach that page — it may be down, paywalled, or blocking us.",
  'not-a-recipe': "We couldn't find a recipe on that page.",
  'ai-failed': 'The recipe reader had trouble with that page — try again, or add it manually.',
};

export function urlImportMessage(code: UrlImportFailureCode): string {
  return URL_IMPORT_COPY[code];
}

// Best-effort, bounded host extraction for the human-readable span name. Never
// throws — a malformed URL just yields 'url' so the trace still names the action.
function hostForSpan(url: string): string {
  try {
    return new URL(url.trim()).hostname || 'url';
  } catch {
    return 'url';
  }
}

// Import a recipe from a URL. Returns the assembled draft as a Recipe entity
// (RecipeDoc is structurally identical), with source.type='url' already set.
// `updatedAt` is left as the server stamp; the editor re-stamps on save.
//
// Distributed tracing (issue #362, Phase 4): start a ROOT span at this user action
// so the trace ORIGINATES here in the browser. Its W3C traceparent is handed to
// the callable (2nd arg), and Phase 3's server side nests the CF + canon + AI
// sub-tree under that same trace id. The callable round-trip is captured as a
// child span so the client-side latency is visible. web-pwa OWNS the observability
// dependency and bridges the traceparent to firebase-sync (Rule 4: firebase-sync
// never imports observability). Tracing is best-effort: when it's inert the span
// is a no-op and the traceparent is '' (omitted by the wrapper), so import works
// exactly as before.
export async function importRecipeFromUrl(
  url: string,
): Promise<ReadResult<Recipe, UrlImportFailureCode>> {
  const trimmed = url.trim();
  const span = startUserActionSpan(`Import recipe from ${hostForSpan(trimmed)}`);
  const child = span.child('callExtractRecipeFromUrl');
  try {
    const result = await callExtractRecipeFromUrl({ url: trimmed }, span.traceparent || undefined);
    child.end();
    if (result.kind !== 'ok') {
      span.setAttribute('import.outcome', result.error);
      span.setError();
      return failure(result.error);
    }
    span.setAttribute('import.outcome', 'ok');
    // `Recipe` is an alias of `RecipeDoc` (issue #417), so the draft is already a
    // Recipe — no cast needed.
    return success(result.value);
  } finally {
    span.end();
  }
}

// Author/apply a recipe via the librarian flow, wrapped in a browser-ROOT span
// (issue #362, Phase 4) so the "Author recipe" action originates a distributed
// trace at the click and the CF + canon + AI sub-tree nests under the same trace
// id. Centralises the span + traceparent plumbing so the three Svelte call sites
// (chat "Save as recipe", chat "Apply changes", recipe-view "Apply changes") don't
// duplicate it. A bounded recipe title (when known) is appended to the span name —
// family-shared content is allowed per the naming/privacy decision, but bounded.
// Best-effort tracing: an inert tracer just yields a no-op span and an empty
// traceparent, so authoring behaves exactly as a bare callAuthorRecipe call.
export async function authorRecipeTraced(
  input: AuthorRecipeInput,
  titleHint?: string,
): Promise<ReadResult<RecipeDoc, DomainError>> {
  const name =
    titleHint && titleHint.trim() ? `Author recipe: ${titleHint.trim()}` : 'Author recipe';
  const span = startUserActionSpan(name);
  const child = span.child('callAuthorRecipe');
  try {
    const result = await callAuthorRecipe(input, span.traceparent || undefined);
    child.end();
    if (result.kind !== 'ok') {
      span.setAttribute('author.outcome', result.error.kind);
      span.setError();
    } else {
      span.setAttribute('author.outcome', 'ok');
    }
    return result;
  } finally {
    span.end();
  }
}

// Hand-off slot for the imported draft. The list page imports, stashes the
// draft here, then routes to /recipes/new; the edit page consumes it once on
// mount (single-use — taking it clears it so a later blank "New recipe" doesn't
// pick up a stale import). Kept in module state (not the route) because the
// draft is a rich object that doesn't belong in a URL.
let _pendingImportDraft: Recipe | null = null;

export function stashImportedDraft(draft: Recipe): void {
  _pendingImportDraft = draft;
}

export function takeImportedDraft(): Recipe | null {
  const d = _pendingImportDraft;
  _pendingImportDraft = null;
  return d;
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
  // Report the batch CF transport failure (the whole canonicalise call failed).
  // Per-row `settled[i]` slots below are per-ingredient match OUTCOMES folded
  // into matchState:'failed' — expected results, not I/O failures — so they are
  // intentionally not reported.
  if (batchResult.kind === 'err') return reportIfFailed(getErrorReporter(), batchResult);
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
  if (parseResult.kind === 'err') return reportIfFailed(getErrorReporter(), parseResult);

  const firstItem = parseResult.value[0]?.items[0];
  if (!firstItem?.parsed) {
    return success({ ...ing, parsed: null, canonId: null, matchState: 'failed' as const });
  }
  const parsed = firstItem.parsed;

  const canonResult = await callCanonicaliseRecipeIngredients({
    items: [{ rawName: parsed.item, rawText: ing.rawText }],
  });
  if (canonResult.kind === 'err') return reportIfFailed(getErrorReporter(), canonResult);

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
  return reportIfFailed(getErrorReporter(), await deleteRecipeDoc(id));
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
  /** Parser's clean item name (parsed.item), raw line as fallback — written as the shopping item's rawText. */
  readonly itemText: string;
  /** Parenthetical notes (parsed.notes) carried to the shopping item's notes field. '' when none. */
  readonly notes: string;
  /** Canon name when live-matched, else the clean item text — the label the sheet shows. */
  readonly name: string;
  readonly fromCanon: boolean;
  readonly isOptional: boolean;
  readonly canonId: string | null;
  readonly matched: boolean;
  readonly amount?: number;
  readonly unit?: string;
  add: boolean;
  check: boolean;
  // ─── Buy-or-make (Phase 2) ───────────────────────────────────────────────────
  // Recipes that PRODUCE this row's ingredient (its `canonId` == their
  // `producesCanonId`), resolved against the recipe snapshot. Empty when none —
  // the review sheet then shows NO buy/make control for the row. The recipe being
  // added is excluded (self-reference guard), so a recipe can't "make" its own
  // ingredient from itself.
  readonly producers: readonly Recipe[];
  // The user's choice for an eligible row. `false` = buy the single item (default,
  // identical to pre-Phase-2 behaviour); `true` = make it by fanning out the
  // chosen producer's ingredients. Meaningless (and ignored) when `producers` is
  // empty.
  make: boolean;
  // Which producer to make when there's more than one candidate. Seeded to the
  // first producer's id; `null` when there are no producers.
  producerId: string | null;
  // ─── Made-header servings (buy-or-make, nested sheet — Phase 2) ──────────────
  // The chosen batch size for the currently-selected producer when this row is
  // Made. FULLY INDEPENDENT of the master recipe's chosen servings and of this
  // row's own required ingredient quantity — it DEFAULTS to the selected
  // producer's own base (`metadata.servings ?? 1`, or 1 when there are no
  // producers) and is only ever moved by the per-header stepper. Stepping it
  // live-rescales `subRows` (rebuilt via `buildMadeSubRows` → `buildRecipeAddPlan`
  // with this value) and is mirrored into every committed sub-entry's
  // `SourceRef.servings`, so the written amounts and the stamped servings agree.
  // Min 1 (enforced by the stepper). Meaningless (and ignored) when `producers`
  // is empty or the row is Buy.
  madeServings: number;
  // ─── Made sub-entries (buy-or-make, nested sheet — Phase 1) ──────────────────
  // When the user selects Make, the chosen producer's own ingredients are built
  // EAGERLY here as nested rows — each a full `RecipeAddRow` with its own
  // `add`/`check` seeded by `recipeItemAddDefault`, rendered as an indented,
  // individually-toggleable sub-entry beneath the (label-only) made header.
  // `null` in the Buy state, where the row is a single ordinary addable line.
  // Rebuilt when Make is toggled or the producer selection changes.
  //
  // ONE LEVEL DEEP: sub-rows carry no producers (`producers: []`, `make: false`,
  // `subRows: null`), so a sub-entry can never itself be "made"/expanded — it is
  // always a plain Add/Check row even if some recipe could also make it. This is
  // a SHEET-ONLY hierarchy: on commit each included sub-entry is still written as
  // a flat sibling shopping-list item stamped with the PRODUCER's `SourceRef`
  // (recipeId/servings/label = the producer's), exactly as before.
  subRows: RecipeAddRow[] | null;
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
  // Snapshot the recipe list once so the buy-or-make resolver (Phase 2) is a pure
  // per-row lookup. `findProducingRecipes` is the pure @salt/domain helper; the
  // self-reference guard (a recipe can't make its own ingredient from itself) is
  // applied here, at the call site.
  const allRecipes = getRecipesSnapshot();

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

      // Prefer the parser's clean item name over the raw line so the shopping row
      // reads without the recipe's amounts/units/prep ("1 x 400g tin chopped
      // tomatoes, drained" → "tomatoes"). Falls back to the raw line when the
      // ingredient is unparsed or the parse yielded an empty item. Preparation
      // phrases are intentionally dropped; parenthetical notes ride to the item's
      // notes field. `parsed.displayText` is deliberately ignored — it is a frozen
      // parse-time measure that would not rescale with servings, so the scaled
      // metric amount/unit stays the source of truth for quantity.
      const itemText = ing.parsed?.item.trim() || ing.rawText;
      const notes = ing.parsed?.notes ?? '';

      // Buy-or-make (Phase 2): a row is eligible when its ingredient's canon link
      // is produced by some OTHER recipe. Keyed off the ingredient's raw `canonId`
      // (not `matched`) so a producer stays offerable even if the canon doc was
      // deleted. Self-reference guard: exclude the recipe being added.
      const producers = ing.canonId
        ? findProducingRecipes(allRecipes, ing.canonId).filter((r) => r.id !== recipe.id)
        : [];

      rows.push({
        ingredientId: ing.id,
        rawText: ing.rawText,
        itemText,
        notes,
        name: canon?.name ?? itemText,
        fromCanon: canon !== null,
        isOptional: ing.isOptional,
        canonId: matched ? ing.canonId : null,
        matched,
        ...(amount !== undefined ? { amount } : {}),
        ...(unit !== undefined ? { unit } : {}),
        add: dflt.add,
        check: dflt.check,
        producers,
        make: false, // default to buy — unchanged behaviour unless the user opts in
        producerId: producers[0]?.id ?? null,
        // Default to the first producer's OWN base servings — never the master
        // recipe's chosen servings, never the required quantity. 1 when nothing
        // produces this row.
        madeServings: producers[0]?.metadata.servings ?? 1,
        subRows: null, // populated eagerly only when the user selects Make
      });
    }
  }
  return rows;
}

// Build the nested sub-entry rows for a made row: the chosen producer's OWN
// ingredients scaled to the header's chosen `madeServings` (Phase 2 — was fixed
// at the producer's base). Each is a full `RecipeAddRow` with its own default
// Add/Check (via `recipeItemAddDefault`, inside `buildRecipeAddPlan`), but with
// its buy-or-make affordance stripped (`producers: []`, `producerId: null`,
// `make: false`, `subRows: null`) so a sub-entry is always a plain toggleable
// row and can never be expanded again — ONE LEVEL DEEP (matching the old
// commit-time rebuild, which seeded `make: false`). Returns `[]` when no
// producer resolves, so the made header then contributes nothing (matching
// commit + count). Pure read against the recipe + canon snapshots (via
// `buildRecipeAddPlan`), so it's safe to call from the sheet on Make/producer/
// servings changes. `buildRecipeAddPlan` scales by `madeServings / producerBase`,
// so `madeServings` at the producer's base leaves amounts as authored.
export function buildMadeSubRows(row: RecipeAddRow): RecipeAddRow[] {
  if (row.producers.length === 0) return [];
  const producer = row.producers.find((r) => r.id === row.producerId) ?? row.producers[0]!;
  return buildRecipeAddPlan(producer, row.madeServings).map((sub) => ({
    ...sub,
    producers: [],
    producerId: null,
    make: false,
    subRows: null,
  }));
}

// How many shopping-list items a confirmed plan will actually write — the number
// the review sheet's "Add N to list" preview must show so it matches the commit
// result (issue #185). Walks the eagerly-built nested structure (Phase 1 of the
// nested sheet), never re-expanding at count time:
//   • a made row (`make`) is a LABEL-ONLY header that emits no item of its own —
//     it contributes only its included (`add: true`) sub-entries;
//   • any other included row (`add: true`, Buy) writes its single item → 1.
// Pure synchronous walk over the in-memory rows — safe to recompute in a Svelte
// `$derived`.
export function recipeAddPlanItemCount(rows: readonly RecipeAddRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.make) {
      // Label-only made header: count only its ticked sub-entries.
      total += (row.subRows ?? []).filter((sub) => sub.add).length;
      continue;
    }
    if (row.add) total += 1;
  }
  return total;
}

// Build the single shopping-list item for one plan row against a `SourceRef`.
// Extracted so the Buy path and the made-header sub-entry path share the exact
// same mapping (clean name, notes, scaled amount/unit, canon match, needsCheck).
// Returns the domain result; a domain `ValidationError` short-circuits commit.
function buildAddedItem(row: RecipeAddRow, source: SourceRef, now: string) {
  return addItem(
    [],
    {
      rawText: row.itemText,
      ...(row.notes ? { notes: row.notes } : {}),
      source,
      now,
      needsCheck: row.check,
      ...(row.matched ? { canonId: row.canonId, matchState: 'matched' as const } : {}),
      ...(row.amount !== undefined ? { amount: row.amount } : {}),
      ...(row.unit !== undefined ? { unit: row.unit } : {}),
    },
    _itemIds,
  );
}

// Write the user-confirmed rows of a recipe-add plan to the shopping list. Only
// rows left as `add: true` are written; `check: true` rows land flagged for
// verification (needsCheck). Matched rows carry their canonId + matchState and
// scaled amount/unit. One item per row — combining is display-time.
//
// Buy-or-make (nested sheet, Phase 1): a made row (`make`) is a LABEL-ONLY header
// that emits NO item of its own. Instead its eagerly-built `subRows` are written
// — walking the nested structure the sheet already prepared, rather than
// re-expanding the producer here. Each included (`add: true`) sub-entry is a flat
// sibling item stamped with the CHOSEN producer's `SourceRef` (recipeId/label =
// the producer's; servings = the header's chosen `madeServings`, Phase 2), so the
// stamped servings match the already-scaled sub-entry amounts and the same canon
// trigger picks it up exactly as before. Sub-rows are one level deep
// (`make: false`), so there is no recursion.
export async function commitRecipeAddPlan(
  recipe: Recipe,
  listId: string,
  servings: number,
  rows: readonly RecipeAddRow[],
): Promise<ReadResult<void, DomainError>> {
  const now = new Date().toISOString();
  const parentSource: SourceRef = {
    kind: 'recipe',
    recipeId: recipe.id,
    servings,
    label: recipe.title,
  };

  // All writes are direct single-item `saveShoppingListItem` calls (Buy rows and
  // made sub-entries alike). Failures are reported here.
  const saves: Promise<ReadResult<void, DomainError>>[] = [];
  for (const row of rows) {
    if (row.make) {
      // Label-only made header: emit nothing for the header; write each included
      // sub-entry stamped with the chosen producer's SourceRef.
      const subRows = row.subRows ?? [];
      if (subRows.length === 0) continue;
      const producer = row.producers.find((r) => r.id === row.producerId) ?? row.producers[0];
      if (!producer) continue;
      // The header's chosen batch size (Phase 2). The sub-entries in `subRows`
      // were already scaled to this same value by `buildMadeSubRows`, so the
      // written amounts and the stamped `SourceRef.servings` agree.
      const subSource: SourceRef = {
        kind: 'recipe',
        recipeId: producer.id,
        servings: row.madeServings,
        label: producer.title,
      };
      for (const sub of subRows) {
        if (!sub.add) continue;
        const result = buildAddedItem(sub, subSource, now);
        if (result.kind !== 'ok') return result;
        saves.push(saveShoppingListItem(listId, result.value[0]!));
      }
      continue;
    }

    if (!row.add) continue;
    const result = buildAddedItem(row, parentSource, now);
    if (result.kind !== 'ok') return result;
    saves.push(saveShoppingListItem(listId, result.value[0]!));
  }

  if (saves.length === 0) return success(undefined);

  const results = await Promise.all(saves);
  // Report the first shopping-list write failure (StorageError/SyncError/etc.);
  // the addItem domain ValidationError above short-circuits before any write and
  // is a suppressed category regardless, so it is intentionally not reported.
  const firstFailure = results.find((r) => r.kind !== 'ok');
  if (firstFailure) return reportIfFailed(getErrorReporter(), firstFailure);
  return success(undefined);
}
