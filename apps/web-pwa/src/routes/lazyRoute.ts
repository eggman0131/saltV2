import type { WrappedComponent } from 'svelte-spa-router';
import { wrap } from 'svelte-spa-router/wrap';
import type { AsyncSvelteComponent } from 'svelte-spa-router/wrap';
import RouteLoading from './RouteLoading.svelte';
import RouteLoadFailed from './RouteLoadFailed.svelte';
import { hasPreloadReloadGuard } from '../lib/pwa';
import { reportWriteError } from '../lib/errorReporting';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';

// Lazy route wrapper with a failed-recovery fallback (issue #472, Phase 2).
//
// Phase 1 (pwa.ts) recovers from a stale-deploy chunk 404 by silently reloading
// ONCE onto the fresh build, guarded so it never loops. This module handles the
// case where that single reload did NOT fix it: a chunk that STILL fails to load
// after the guard is set must not hang on the route loader forever.
// `loadRouteWithFallback` catches the persistent import rejection and resolves to
// an inline "couldn't load this page — retry" screen (RouteLoadFailed), keeping
// the rest of the app usable. On a FIRST failure (guard not yet set) it rethrows
// so Phase 1's `vite:preloadError` listener still performs its one silent reload
// — and that self-healing path stays UNREPORTED. Reporting fires ONLY on failed
// recovery, so exactly one version-stamped PostHog issue appears per stuck chunk.

// Lazy PostHog error-reporting adapter (the ErrorReportingPort), matching the
// per-service singleton pattern (canonService/chatService/recipeService). Only
// constructed on the first failed recovery, never on the happy path.
let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter(): ReturnType<typeof createObservabilityErrorReportingAdapter> {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// Report a failed route-chunk recovery through the app-level errorReporting.ts
// wrapper (never posthog-js directly — Rule 11). The chunk URL is scrubbed
// context (a URL, not free-form user content) and rides in the Error MESSAGE
// because the observability adapter attaches only the category, no context bag.
// StorageError is a reportable category (an unexpected asset-fetch failure), so
// it surfaces one issue with `app_version` riding along as a super property.
// Best-effort and MUST NOT throw (Rule 10).
function reportRouteLoadFailure(err: unknown): void {
  try {
    const detail = err instanceof Error && err.message ? err.message : String(err);
    reportWriteError(
      getErrorReporter(),
      { kind: 'StorageError', reason: 'unavailable' },
      new Error(`route chunk load failed: ${detail}`),
    );
  } catch {
    /* reporting is best-effort — a report failure must never break the fallback */
  }
}

// Wrap a lazy route thunk so a persistent chunk-load failure degrades to an
// inline retry fallback (see block comment above). Exported for unit tests.
export async function loadRouteWithFallback(
  load: AsyncSvelteComponent,
): ReturnType<AsyncSvelteComponent> {
  // Snapshot the guard at load START, not at rejection time. Phase 1's
  // `vite:preloadError` listener sets the guard SYNCHRONOUSLY as it fires the
  // very first failure's reload, so a rejection-time read could see the guard
  // already set on a first, about-to-reload failure and wrongly report on the
  // successful-reload path. Reading at start cleanly means: guard set here ⇒ we
  // already reloaded once this session and are STILL failing ⇒ failed recovery.
  const alreadyReloaded = hasPreloadReloadGuard();
  try {
    return await load();
  } catch (err) {
    // First failure this session: let Phase 1 do its single silent reload.
    // Rethrow so `wrap()` surfaces the rejection to Vite's listener, and do NOT
    // report (a stale-chunk reload is expected, self-healing recovery).
    if (!alreadyReloaded) throw err;
    // Already reloaded and still broken: report once and show the fallback.
    reportRouteLoadFailure(err);
    return { default: RouteLoadFailed };
  }
}

// Wrap a lazily-imported route in svelte-spa-router's `wrap()`, showing
// RouteLoading while the chunk fetches and the failed-recovery fallback if it
// never loads. `RouteLoading` is a dependency-free placeholder kept in the boot
// chunk so it never itself triggers a fetch at load time.
export const lazy = (asyncComponent: AsyncSvelteComponent): WrappedComponent =>
  wrap({
    asyncComponent: () => loadRouteWithFallback(asyncComponent),
    loadingComponent: RouteLoading,
  });
