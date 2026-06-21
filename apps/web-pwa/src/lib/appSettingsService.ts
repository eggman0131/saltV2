import { subscribeAppSettings, saveAppSettings } from '@salt/firebase-sync';
import {
  AI_MODEL_DEFAULTS,
  AI_MODEL_ROLES,
  type AppSettings,
  type AiModelRole,
} from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';

// Admin-managed AI model settings (Phase 1). Subscribes to the per-environment
// `appSettings/singleton` doc. Each role defaults to today's exact production
// model literal, so the effective config matches current behaviour even before
// the doc loads and when no doc exists — and a deleted/corrupt doc is harmless.

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

// Builds the next full doc from the current store (or defaults), applying the
// per-role override and refreshing the audit metadata. The whole doc is written
// (last-write-wins) so unset fields fall back to schema defaults.
function buildNext(role: AiModelRole, model: string | undefined): AppSettings {
  const current: AppSettings = get(_settings) ?? {
    ...AI_MODEL_DEFAULTS,
    schemaVersion: 1,
  };
  return {
    ...current,
    // Clearing a field (undefined) means "use the default": persist the default
    // literal so the saved doc is self-describing and the readout is stable.
    [role]: model && model.trim() ? model.trim() : AI_MODEL_DEFAULTS[role],
    schemaVersion: 1,
    updatedAt: Date.now(),
    updatedBy: auth.user?.email ?? 'unknown',
  };
}

// Sets a role's model to a free-text value. An empty/blank value resets the
// role to its default (same as resetModelRole).
export function setModelRole(
  role: AiModelRole,
  model: string,
): Promise<ReadResult<void, DomainError>> {
  const next = buildNext(role, model);
  _settings.set(next);
  return saveAppSettings(next);
}

// Resets a single role back to today's default model.
export function resetModelRole(role: AiModelRole): Promise<ReadResult<void, DomainError>> {
  const next = buildNext(role, undefined);
  _settings.set(next);
  return saveAppSettings(next);
}

export function __resetAppSettingsServiceForTest(): void {
  unsub?.();
  unsub = null;
  _settings.set(null);
  _isLoading.set(true);
  _isCorrupt.set(false);
}
