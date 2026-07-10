import { subscribeDevSettings, saveDevSettings } from '@salt/firebase-sync';
import type { DevSettingsDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Development settings service (issue #238). Subscribes to the per-environment
// `devSettings/singleton` doc. Holds the AI-image generation kill-switches (canon
// icons; recipe heroes, issue #148). Defaults to enabled until the doc loads and
// when no doc exists — matching the CF triggers' fail-open default.

const DEFAULTS: DevSettingsDoc = {
  canonIconGenerationEnabled: true,
  recipeImageGenerationEnabled: true,
  schemaVersion: 1,
};

const _settings = writable<DevSettingsDoc | null>(null);
const _isLoading = writable(true);

export const devSettings: Readable<DevSettingsDoc | null> = _settings;
export const isLoadingDevSettings: Readable<boolean> = _isLoading;

export const canonIconGenerationEnabled: Readable<boolean> = derived(
  _settings,
  ($s) => $s?.canonIconGenerationEnabled ?? DEFAULTS.canonIconGenerationEnabled,
);

export const recipeImageGenerationEnabled: Readable<boolean> = derived(
  _settings,
  ($s) => $s?.recipeImageGenerationEnabled ?? DEFAULTS.recipeImageGenerationEnabled,
);

let unsub: (() => void) | null = null;

export function initDevSettingsSync(): () => void {
  _isLoading.set(true);
  unsub = subscribeDevSettings(
    (s) => {
      _settings.set(s);
      _isLoading.set(false);
    },
    () => _isLoading.set(false),
  );
  return () => {
    unsub?.();
    unsub = null;
  };
}

// Optimistically updates the store, then persists. The whole doc is written
// (last-write-wins) so unset fields fall back to their defaults.
export function setCanonIconGenerationEnabled(
  enabled: boolean,
): Promise<ReadResult<void, DomainError>> {
  const next: DevSettingsDoc = {
    ...(get(_settings) ?? DEFAULTS),
    canonIconGenerationEnabled: enabled,
  };
  _settings.set(next);
  return saveDevSettings(next);
}

export function setRecipeImageGenerationEnabled(
  enabled: boolean,
): Promise<ReadResult<void, DomainError>> {
  const next: DevSettingsDoc = {
    ...(get(_settings) ?? DEFAULTS),
    recipeImageGenerationEnabled: enabled,
  };
  _settings.set(next);
  return saveDevSettings(next);
}

export function __resetDevSettingsServiceForTest(): void {
  unsub?.();
  unsub = null;
  _settings.set(null);
  _isLoading.set(true);
}
