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
// refetches). Resolves to a ReadResult rather than throwing.
export async function callRefreshWeatherForecast(
  force = false,
): Promise<ReadResult<RefreshWeatherForecastResult, DomainError>> {
  try {
    const fn = httpsCallable<{ force: boolean }, RefreshWeatherForecastResult>(
      getFunctions(undefined, 'europe-west2'),
      'refreshWeatherForecast',
    );
    const res = await fn({ force });
    return { kind: 'ok', value: res.data };
  } catch (err) {
    return failure(mapCallableError(err));
  }
}
