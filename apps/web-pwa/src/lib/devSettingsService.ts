import { subscribeDevSettings, saveDevSettings } from '@salt/firebase-sync';
import type { DevSettingsDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Development settings service (issue #238). Subscribes to the per-environment
// `devSettings/singleton` doc. Currently just the canon-icon generation
// kill-switch. Defaults to enabled until the doc loads and when no doc exists —
// matching the CF trigger's fail-open default.

const DEFAULTS: DevSettingsDoc = { canonIconGenerationEnabled: true, schemaVersion: 1 };

const _settings = writable<DevSettingsDoc | null>(null);
const _isLoading = writable(true);

export const devSettings: Readable<DevSettingsDoc | null> = _settings;
export const isLoadingDevSettings: Readable<boolean> = _isLoading;

export const canonIconGenerationEnabled: Readable<boolean> = derived(
  _settings,
  ($s) => $s?.canonIconGenerationEnabled ?? DEFAULTS.canonIconGenerationEnabled,
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

export function __resetDevSettingsServiceForTest(): void {
  unsub?.();
  unsub = null;
  _settings.set(null);
  _isLoading.set(true);
}
