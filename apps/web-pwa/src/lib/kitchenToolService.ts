import { subscribeKitchenTools } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import { resolveKitchenTool, isCanonIconRenderable } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { reportSubscriptionError } from './errorReporting.js';

// The curated kitchen-tool pictogram vocabulary (issue #882).
//
// Read-only in Phase 1: the list is seeded offline and every surface only ever
// looks a name up in it. Nothing here writes, and nothing anywhere stores a tool
// id — a recipe step and a guided plan card keep the cook's own words, and the
// tool is found from those words each time a row is drawn.

// ─── Reactive stores ────────────────────────────────────────────────────────────

const _kitchenTools = writable<readonly KitchenToolDoc[]>([]);
export const kitchenTools: Readable<readonly KitchenToolDoc[]> = _kitchenTools;

const _isLoadingKitchenTools = writable(false);
export const isLoadingKitchenTools: Readable<boolean> = _isLoadingKitchenTools;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

export function initKitchenToolSync(): () => void {
  _isLoadingKitchenTools.set(true);
  const errors = getErrorReporter();

  return subscribeKitchenTools(
    (tools) => {
      _kitchenTools.set(tools);
      _isLoadingKitchenTools.set(false);
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );
}

// ─── Snapshot ────────────────────────────────────────────────────────────────────

export function getKitchenToolsSnapshot(): readonly KitchenToolDoc[] {
  return get(_kitchenTools);
}

// ─── The one shared lookup ───────────────────────────────────────────────────────
//
// THE POINT OF PUTTING THIS HERE. The `thumbnailFor` / `iconVersionFor` pair is
// already written out by hand three times over — ShoppingListPage.svelte:155,
// CookModePage.svelte:464-469 and GuidedCookPage.svelte:335-340 — and each copy
// is a place the cache-bust rule (`iconRequestedAt ?? updatedAt`, ui-spec-v04
// §14.4) or the tri-state render guard can quietly drift. This family gets ONE
// definition, exported, and every surface that draws a tool uses it. Do not add a
// fourth private copy to a page.
//
// It is a DERIVED STORE OF A LOOKUP rather than two plain functions, and that is
// reactivity rather than taste: a plain function reading a snapshot has no
// tracked dependency on the store, so the vocabulary arriving after first paint —
// which is exactly what happens on a cold load — would leave every tile bare
// until something unrelated re-rendered the page.

/** The tool lookup a surface calls, resolved against one snapshot of the list. */
export interface ToolIconLookup {
  /** The renderable pictogram URL for a free-text container name, or null. */
  toolIconFor(label: string | null | undefined): string | null;
  /** The display-time cache-bust nonce for that same name, or undefined. */
  toolIconVersionFor(label: string | null | undefined): string | number | undefined;
}

function lookupFor(tools: readonly KitchenToolDoc[]): ToolIconLookup {
  // Null on every miss, and a miss is a normal outcome rather than a fault: an
  // unrecognised name renders as words with no picture, which is the whole
  // contract of a closed vocabulary. `isCanonIconRenderable` folds the other two
  // non-drawing states in — not generated yet, and hidden by the user.
  const resolve = (label: string | null | undefined): KitchenToolDoc | null => {
    const name = label?.trim();
    if (!name) return null;
    return resolveKitchenTool(name, tools);
  };
  return {
    toolIconFor(label) {
      const tool = resolve(label);
      if (!tool || !isCanonIconRenderable(tool.thumbnail)) return null;
      return tool.thumbnail;
    },
    toolIconVersionFor(label) {
      const tool = resolve(label);
      if (!tool || !isCanonIconRenderable(tool.thumbnail)) return undefined;
      return tool.iconRequestedAt ?? tool.updatedAt;
    },
  };
}

/**
 * The shared lookup, recomputed whenever the vocabulary changes. Subscribe to it
 * (`$toolIcons.toolIconFor(name)`) so a tile fills in the moment the list lands.
 */
export const toolIcons: Readable<ToolIconLookup> = derived(_kitchenTools, lookupFor);

// ─── Test helpers ────────────────────────────────────────────────────────────────

export function __resetKitchenToolServiceForTest(): void {
  _kitchenTools.set([]);
  _isLoadingKitchenTools.set(false);
  _errorReporter = null;
}
