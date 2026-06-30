import { subscribeAppSettings, saveAppSettings } from '@salt/firebase-sync';
import {
  AI_MODEL_DEFAULTS,
  AI_MODEL_ROLES,
  AI_FLOW_ROLES,
  AI_FLOW_IDS,
  type AppSettings,
  type AiModelRole,
  type AiFlowId,
  type HomeLocation,
} from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';

// Admin-managed AI model settings (Phase 1 + Phase 2). Subscribes to the
// per-environment `appSettings/singleton` doc. Each role defaults to today's
// exact production model literal, so the effective config matches current
// behaviour even before the doc loads and when no doc exists — and a
// deleted/corrupt doc is harmless. Phase 2 adds optional per-flow overrides that
// take precedence over the flow's role.

const _settings = writable<AppSettings | null>(null);
const _isLoading = writable(true);
const _isCorrupt = writable(false);

export const appSettings: Readable<AppSettings | null> = _settings;
export const isLoadingAppSettings: Readable<boolean> = _isLoading;
// True when the doc exists but failed validation. The UI surfaces a warning;
// the effective config still falls back to defaults so AI keeps working.
export const isAppSettingsCorrupt: Readable<boolean> = _isCorrupt;

// The model that each role actually resolves to right now: the saved value if
// present, otherwise today's default. Mirrors the CF resolver's fallback so the
// admin UI's "effective model" readout matches what the flows really use.
export const effectiveModels: Readable<Record<AiModelRole, string>> = derived(_settings, ($s) => {
  const out = {} as Record<AiModelRole, string>;
  for (const role of AI_MODEL_ROLES) {
    out[role] = $s?.[role] ?? AI_MODEL_DEFAULTS[role];
  }
  return out;
});

// The model each flow actually resolves to, mirroring the CF resolver's
// precedence: per-flow override → role's model → role's default. The admin UI
// uses this for each flow's "effective model" readout so it matches the flows.
export const effectiveFlowModels: Readable<Record<AiFlowId, string>> = derived(_settings, ($s) => {
  const out = {} as Record<AiFlowId, string>;
  for (const flowId of AI_FLOW_IDS) {
    const role = AI_FLOW_ROLES[flowId];
    const override = $s?.perFlow?.[flowId];
    out[flowId] = override?.trim() ? override : ($s?.[role] ?? AI_MODEL_DEFAULTS[role]);
  }
  return out;
});

let unsub: (() => void) | null = null;

export function initAppSettingsSync(): () => void {
  _isLoading.set(true);
  unsub = subscribeAppSettings(
    (s) => {
      _settings.set(s);
      _isCorrupt.set(false);
      _isLoading.set(false);
    },
    (err) => {
      // A corrupt doc surfaces here; keep the store null so effective config
      // falls back to defaults, and flag corruption for the UI.
      _isCorrupt.set(err.kind === 'StorageError' && err.reason === 'corruption');
      _isLoading.set(false);
    },
  );
  return () => {
    unsub?.();
    unsub = null;
  };
}

// The current doc (or a defaults skeleton if none has loaded), the base every
// mutation merges onto. The whole doc is written (last-write-wins), so unset
// role fields fall back to schema defaults.
function currentDoc(): AppSettings {
  return (
    get(_settings) ?? {
      ...AI_MODEL_DEFAULTS,
      schemaVersion: 1,
    }
  );
}

// Stamps audit metadata onto a built doc and bumps schemaVersion.
function withAudit(doc: AppSettings): AppSettings {
  return {
    ...doc,
    schemaVersion: 1,
    updatedAt: Date.now(),
    updatedBy: auth.user?.email ?? 'unknown',
  };
}

// Persists a built doc: optimistically updates the store, then writes through.
function persist(next: AppSettings): Promise<ReadResult<void, DomainError>> {
  _settings.set(next);
  return saveAppSettings(next);
}

// Builds the next full doc applying a per-role override. Per-flow overrides on
// the current doc are preserved untouched (they sit on a sibling field).
function buildNext(role: AiModelRole, model: string | undefined): AppSettings {
  return withAudit({
    ...currentDoc(),
    // Clearing a field (undefined) means "use the default": persist the default
    // literal so the saved doc is self-describing and the readout is stable.
    [role]: model && model.trim() ? model.trim() : AI_MODEL_DEFAULTS[role],
  });
}

// Sets a role's model to a free-text value. An empty/blank value resets the
// role to its default (same as resetModelRole).
export function setModelRole(
  role: AiModelRole,
  model: string,
): Promise<ReadResult<void, DomainError>> {
  return persist(buildNext(role, model));
}

// Resets a single role back to today's default model.
export function resetModelRole(role: AiModelRole): Promise<ReadResult<void, DomainError>> {
  return persist(buildNext(role, undefined));
}

// Builds the next full doc applying a per-flow override. A blank value clears
// the override (delete the key) so the flow falls back to its role; a non-empty
// value sets the override. An empty `perFlow` map is dropped entirely to keep
// the saved doc clean and match the "absent = no overrides" back-compat shape.
function buildNextFlow(flowId: AiFlowId, model: string | undefined): AppSettings {
  const doc = currentDoc();
  const perFlow: Record<string, string> = { ...(doc.perFlow ?? {}) };
  const trimmed = model?.trim();
  if (trimmed) {
    perFlow[flowId] = trimmed;
  } else {
    delete perFlow[flowId];
  }
  const next: AppSettings = { ...doc };
  if (Object.keys(perFlow).length > 0) {
    next.perFlow = perFlow;
  } else {
    delete next.perFlow;
  }
  return withAudit(next);
}

// Sets a flow's override to a free-text value. An empty/blank value clears the
// override (same as resetFlowOverride), so the flow inherits its role's model.
export function setFlowOverride(
  flowId: AiFlowId,
  model: string,
): Promise<ReadResult<void, DomainError>> {
  return persist(buildNextFlow(flowId, model));
}

// Clears a single flow's override, falling it back to its role's model.
export function resetFlowOverride(flowId: AiFlowId): Promise<ReadResult<void, DomainError>> {
  return persist(buildNextFlow(flowId, undefined));
}

// Builds the next full doc applying the family home location. A defined location
// sets the field; `undefined` clears it (delete the key) so the back-compat
// "absent = not set" shape is preserved and we never store an empty object.
function buildNextHomeLocation(location: HomeLocation | undefined): AppSettings {
  const next: AppSettings = { ...currentDoc() };
  if (location) {
    next.homeLocation = location;
  } else {
    delete next.homeLocation;
  }
  return withAudit(next);
}

// Sets the family home location (from a geocoding pick or manual entry).
export function setHomeLocation(location: HomeLocation): Promise<ReadResult<void, DomainError>> {
  return persist(buildNextHomeLocation(location));
}

// Clears the family home location.
export function resetHomeLocation(): Promise<ReadResult<void, DomainError>> {
  return persist(buildNextHomeLocation(undefined));
}

export function __resetAppSettingsServiceForTest(): void {
  unsub?.();
  unsub = null;
  _settings.set(null);
  _isLoading.set(true);
  _isCorrupt.set(false);
}
