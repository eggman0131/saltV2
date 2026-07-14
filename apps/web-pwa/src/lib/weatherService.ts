import { subscribeWeatherForecast, callRefreshWeatherForecast } from '@salt/firebase-sync';
import { isForecastStale } from '@salt/domain';
import type { WeatherForecast } from '@salt/domain/schemas';
import { startUserActionSpan } from '@salt/observability';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { appSettings } from './appSettingsService.js';

// Weather forecast cache subscription + on-access refresh (issue #382, Phase 3).
// Mirrors appSettingsService.ts: subscribe to the weatherForecast/singleton cache
// doc and expose an in-memory Svelte store; the planner reads the store to render
// each in-window day's evening summary, and calls ensureFreshForecast() on mount
// to silently refetch when the cache has gone stale.
//
// CLAUDE.md Rule 3 — NO browser storage: the ONLY cache is the Firestore doc plus
// Firestore's own persistentLocalCache. This service holds an in-memory store
// only; nothing is written to localStorage/IndexedDB here. The browser never
// fetches Open-Meteo directly (the CF does) — this only subscribes to the cache
// doc and invokes the refresh callable.

const _forecast = writable<WeatherForecast | null>(null);

// The current cached forecast (or null when none has loaded / none exists yet).
// Day key absent ⇒ that date is out of the forecast window (Phase 2 contract).
// A corrupt or errored cache doc leaves this null — the planner treats absent and
// corrupt identically (renders no weather), so there's no separate corrupt flag.
export const weatherForecast: Readable<WeatherForecast | null> = _forecast;

let unsub: (() => void) | null = null;

// Starts the cache-doc subscription. Bootstrapped from App.svelte's post-auth
// $effect alongside the other sync services; returns an unsubscribe for the effect
// cleanup. A corrupt doc surfaces via onError → the store keeps its current value.
export function initWeatherSync(): () => void {
  unsub = subscribeWeatherForecast(
    (f) => {
      _forecast.set(f);
    },
    () => {
      // A corrupt or errored cache doc leaves the last-known forecast in place
      // (or null if none loaded); the planner renders no weather either way.
    },
  );
  return () => {
    unsub?.();
    unsub = null;
  };
}

// In-flight guard so rapid planner re-mounts (or several quick navigations) don't
// fire overlapping refresh calls. Best-effort — a refresh failure clears it so a
// later access can retry.
let refreshing = false;

// On planner access: if a home location is set AND the cached forecast is stale
// (>1h old or the home location moved), trigger a server-side refresh. We pass NO
// force — the server does its own staleness re-check and will skip the external
// fetch if another client already refreshed (so concurrent planner opens don't
// each refetch). No home location ⇒ no-op. Never throws (the callable wrapper
// returns a ReadResult); a failed refresh is silent — the planner keeps showing
// the last cached forecast, and the next access retries.
export async function ensureFreshForecast(): Promise<void> {
  const homeLocation = get(appSettings)?.homeLocation;
  if (!homeLocation) return; // nothing to fetch without a home location

  if (!isForecastStale(get(_forecast), homeLocation, Date.now())) return; // still fresh
  if (refreshing) return;

  refreshing = true;
  // Optional browser→CF trace continuity: root a user-action span and hand its
  // traceparent to the callable so the refresh renders as one trace rooted at the
  // planner open. Inert no-op when tracing is off; never throws (Rule 10).
  const span = startUserActionSpan('Refresh weather');
  const child = span.child('callRefreshWeatherForecast');
  try {
    const result = await callRefreshWeatherForecast(false, span.traceparent || undefined);
    child.end();
    if (result.kind !== 'ok') {
      span.setAttribute('weather.refresh.outcome', result.error.kind);
      span.setError();
    } else {
      span.setAttribute('weather.refresh.outcome', result.value.skipped ? 'skipped' : 'fetched');
    }
    // The subscription delivers the new doc; nothing to apply here.
  } finally {
    span.end();
    refreshing = false;
  }
}

export function __resetWeatherServiceForTest(): void {
  unsub?.();
  unsub = null;
  refreshing = false;
  _forecast.set(null);
}
