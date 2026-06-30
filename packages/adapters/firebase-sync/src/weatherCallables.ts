import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import type { WeatherForecast } from '@salt/domain/schemas';

// Browser → refreshWeatherForecast callable wrapper (issue #382, Phase 2).
// CLAUDE.md Rule 2: the Firebase SDK is only touched here. web-pwa consumes this
// wrapper, never `firebase/functions` directly. Mirrors aiModelCallables.ts: map
// the callable error codes to DomainError and return a ReadResult — never throw.

// The result the CF returns. `homeLocationSet` false means no home location is
// configured (nothing fetched); `skipped` true means an existing cache was still
// fresh and the external fetch was skipped (the server-side staleness re-check);
// `forecast` is the doc now current (or null when no home location is set). The
// admin readout subscribes to the cache doc for the live values; this result just
// lets the UI report skip-vs-fetch and the no-location case.
export interface RefreshWeatherForecastResult {
  readonly homeLocationSet: boolean;
  readonly skipped: boolean;
  readonly forecast: WeatherForecast | null;
}

function mapCallableError(err: unknown): DomainError {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'functions/unauthenticated') {
    return { kind: 'AuthError', reason: 'unauthenticated' };
  }
  if (code === 'functions/permission-denied') {
    return { kind: 'AuthError', reason: 'forbidden' };
  }
  return { kind: 'NetworkError', reason: 'transient' };
}

// Triggers a server-side forecast refresh. `force` bypasses the server's <3h
// staleness skip (the admin "Refresh" button sets it so a manual refresh always
// refetches). The optional TRAILING `traceparent` (issue #382, Phase 3) is a
// browser-supplied W3C trace id that rides on the callable WIRE input so the CF
// flow nests under the browser's "Refresh weather" trace instead of re-rooting;
// it is additive and back-compat — the Phase 2 admin caller passes only `force`
// and an empty/absent value is simply not sent (the CF treats it as optional and
// never fails on it). Resolves to a ReadResult rather than throwing.
export async function callRefreshWeatherForecast(
  force = false,
  traceparent?: string,
): Promise<ReadResult<RefreshWeatherForecastResult, DomainError>> {
  try {
    const fn = httpsCallable<
      { force: boolean; traceparent?: string },
      RefreshWeatherForecastResult
    >(getFunctions(undefined, 'europe-west2'), 'refreshWeatherForecast');
    // Only attach `traceparent` when present so old-shape calls stay byte-for-byte
    // identical to Phase 2 (the wire field is optional on the schema).
    const res = await fn(traceparent ? { force, traceparent } : { force });
    return { kind: 'ok', value: res.data };
  } catch (err) {
    return failure(mapCallableError(err));
  }
}
