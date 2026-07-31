import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import type { DomainError } from '@salt/shared-types';

// Phase 2: failed-recovery fallback for stale-deploy chunk-load failures.
//
// `loadRouteWithFallback` wraps a lazy route thunk. When Phase 1 has ALREADY
// spent its one silent auto-reload this session (guard set) and the chunk STILL
// fails, it must resolve to the inline RouteLoadFailed fallback AND report the
// failure exactly once. On a FIRST failure (guard not set) it must rethrow so
// Phase 1's reload path runs, and it must NOT report.

// Controllable Phase 1 guard. routes/lazyRoute reads it at load START to decide
// first-failure (rethrow, no report) vs failed-recovery (fallback + report).
const { guardSpy, reportSpy } = vi.hoisted(() => ({
  guardSpy: vi.fn<() => boolean>(() => false),
  reportSpy: vi.fn(),
}));

vi.mock('../src/lib/pwa.js', () => ({
  hasPreloadReloadGuard: () => guardSpy(),
}));

// errorReporting.ts imports isAuthTransitioning at module top; stub the adapter
// package so no real Firebase/PostHog is pulled in.
vi.mock('@salt/firebase-sync', () => ({
  isAuthTransitioning: () => false,
}));

// Stable, GATED report() spy — delegates to the REAL category gate so the
// StorageError category genuinely reports (and a suppressed category would not),
// mirroring chatService.errorReporting.test.ts.
vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

import { loadRouteWithFallback, lazy } from '../src/routes/lazyRoute.js';
import RouteLoadFailed from '../src/routes/RouteLoadFailed.svelte';
import LazyRoute from '../src/routes/LazyRoute.svelte';
import NotFound from '../src/routes/NotFound.svelte';

const CHUNK_URL = 'https://app.example/assets/ChatListPage-abc123.js';
const failLoad = () =>
  Promise.reject(new Error(`Failed to fetch dynamically imported module: ${CHUNK_URL}`));

beforeEach(() => {
  vi.clearAllMocks();
  guardSpy.mockReturnValue(false);
});

describe('loadRouteWithFallback — failed-recovery fallback (Phase 2)', () => {
  it('resolves to the RouteLoadFailed fallback when the guard is ALREADY tripped and the chunk still fails', async () => {
    guardSpy.mockReturnValue(true);
    const resolved = (await loadRouteWithFallback(failLoad)) as { default: unknown };
    expect(resolved.default).toBe(RouteLoadFailed);
  });

  it('reports ONLY on failed recovery (guard set): one StorageError carrying the chunk URL in the message', async () => {
    guardSpy.mockReturnValue(true);
    await loadRouteWithFallback(failLoad);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    const [reportedError, category] = reportSpy.mock.calls[0]!;
    expect(category).toBe('StorageError');
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toContain(CHUNK_URL);
  });

  it('does NOT report on a first failure (guard not set): it rethrows for Phase 1 to silently reload', async () => {
    guardSpy.mockReturnValue(false);
    await expect(loadRouteWithFallback(failLoad)).rejects.toThrow(
      /Failed to fetch dynamically imported module/,
    );
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('passes the component straight through and never reports on a successful load', async () => {
    guardSpy.mockReturnValue(true);
    const okModule = { default: RouteLoadFailed };
    const resolved = await loadRouteWithFallback(() => Promise.resolve(okModule));
    expect(resolved).toBe(okModule);
    expect(reportSpy).not.toHaveBeenCalled();
  });
});

// ─── Issue #599: a lazy route must never strand the loading placeholder ───────
//
// svelte-spa-router@5.1.1's location effect assigns its module-scoped
// `componentObj = obj` BEFORE awaiting a lazy route — but only on the branch that
// renders a `loadingComponent` (Router.svelte, `if (obj.loading)`). A second
// location change landing mid-import cancels the first run; the re-run then sees
// `componentObj == obj`, skips the load-and-swap entirely, and leaves the spinner
// up permanently at the right URL with nothing pending. Registering with
// `component` instead takes the branch that resets `componentObj = null` first, so
// a re-run always re-enters — and the import itself now lives in LazyRoute, where a
// second navigation is an ordinary prop change.
describe('lazy() — router registration (issue #599)', () => {
  it('registers on the branch that cannot strand a route: no loadingComponent', () => {
    const wrapped = lazy(() => Promise.resolve({ default: NotFound }));
    // `obj.loading` is the ENTIRE precondition for the upstream hang. Its absence
    // is what this guards — do not reintroduce a `loadingComponent` here.
    expect((wrapped.component as { loading?: unknown }).loading).toBeUndefined();
    expect(wrapped.props).toMatchObject({ load: expect.any(Function) });
  });
});

describe('LazyRoute — the host that owns the chunk fetch (issue #599)', () => {
  it('shows the loading placeholder until the chunk resolves, then swaps it in', async () => {
    let release!: (mod: { default: unknown }) => void;
    const load = () => new Promise<{ default: unknown }>((r) => (release = r));

    const { getByRole, findByText } = render(LazyRoute, { props: { load } });
    expect(getByRole('status', { name: 'Loading' })).toBeTruthy();

    release({ default: NotFound });
    expect(await findByText(/page not found/i)).toBeTruthy();
    cleanup();
  });

  it('a second navigation landing MID-IMPORT lands on the new route, not a stranded spinner', async () => {
    let releaseFirst!: (mod: { default: unknown }) => void;
    const slowLoad = () => new Promise<{ default: unknown }>((r) => (releaseFirst = r));
    const secondLoad = () => Promise.resolve({ default: RouteLoadFailed });

    // Navigation 1 starts and is still in flight…
    const { rerender, findByText, queryByRole } = render(LazyRoute, { props: { load: slowLoad } });
    // …navigation 2 arrives before it resolves.
    await rerender({ load: secondLoad });
    // The first import completing afterwards must not overwrite the second.
    releaseFirst({ default: NotFound });

    expect(await findByText(/couldn't load this page/i)).toBeTruthy();
    expect(queryByRole('status', { name: 'Loading' })).toBeNull();
    cleanup();
  });
});

describe('RouteLoadFailed — inline fallback component', () => {
  it('renders a clear "couldn\'t load" message with a Retry affordance', () => {
    const { getByText, getByRole } = render(RouteLoadFailed);
    expect(getByText(/couldn't load this page/i)).toBeTruthy();
    const retry = getByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
    cleanup();
  });
});
