import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import {
  callListAiModels,
  callTestModel,
  type AiCatalogModel,
  type AiModelCatalog,
} from '@salt/firebase-sync';
import { AI_MODEL_ROLES, type AiModelRole } from '@salt/domain/schemas';

// Live Gemini model catalog for the admin AI-settings page (Phase 3). Calls the
// firebase-sync wrappers (which own the Firebase SDK) and holds the
// capability-filtered, per-role lists in a store. Exposes a `refresh()` that
// force-re-fetches the catalog and a `testModel()` that probes one model.
//
// The catalog is best-effort: if it is unavailable (offline, non-admin, AI key
// missing server-side), the store stays empty and the UI falls back to free-text
// entry — the combobox keeps working with `allowCustom`, just without
// suggestions.

const emptyByRole = (): Record<AiModelRole, AiCatalogModel[]> => {
  const out = {} as Record<AiModelRole, AiCatalogModel[]>;
  for (const role of AI_MODEL_ROLES) out[role] = [];
  return out;
};

const _byRole = writable<Record<AiModelRole, AiCatalogModel[]>>(emptyByRole());
const _isLoading = writable(false);
// True when the last fetch failed (or never ran). Drives the "fell back to
// free-text" UX without blocking the page.
const _isUnavailable = writable(true);

// Per-role filtered model lists. Empty when the catalog is unavailable.
export const catalogByRole: Readable<Record<AiModelRole, AiCatalogModel[]>> = _byRole;
export const isCatalogLoading: Readable<boolean> = _isLoading;
export const isCatalogUnavailable: Readable<boolean> = _isUnavailable;

// True once at least one role has models — i.e. the combobox can show
// suggestions. When false, fields fall back to plain free-text.
export const hasCatalog: Readable<boolean> = derived(_byRole, ($byRole) =>
  AI_MODEL_ROLES.some((role) => $byRole[role].length > 0),
);

function applyCatalog(catalog: AiModelCatalog): void {
  // Defensive: ensure every role key exists even if the server omits one.
  const next = emptyByRole();
  for (const role of AI_MODEL_ROLES) {
    next[role] = catalog.byRole[role] ?? [];
  }
  _byRole.set(next);
  _isUnavailable.set(false);
}

async function load(forceRefresh: boolean): Promise<void> {
  _isLoading.set(true);
  const result = await callListAiModels(forceRefresh);
  _isLoading.set(false);
  if (result.kind === 'ok') {
    applyCatalog(result.value);
  } else {
    // Leave any previously-loaded catalog in place on a transient refresh
    // failure, but flag unavailability so the UI can hint at free-text fallback.
    _isUnavailable.set(get(hasCatalog) ? false : true);
  }
}

// Lazily loads the catalog once (no-op if already loaded). Safe to call on mount.
export async function ensureCatalog(): Promise<void> {
  if (!get(_isUnavailable)) return;
  await load(false);
}

// Force a fresh fetch (the "Refresh" control), bypassing the CF cache.
export async function refreshCatalog(): Promise<void> {
  await load(true);
}

// Probes a model server-side; returns the ok/error outcome for the UI to surface.
export async function testModel(
  model: string,
  role?: AiModelRole,
): Promise<{ ok: boolean; error?: string }> {
  const result = await callTestModel(model, role);
  if (result.kind === 'ok') return result.value;
  // A wrapper-level failure (auth/network) — present it as a failed probe.
  return { ok: false, error: 'Could not reach the model test service.' };
}

export function __resetAiModelCatalogServiceForTest(): void {
  _byRole.set(emptyByRole());
  _isLoading.set(false);
  _isUnavailable.set(true);
}
