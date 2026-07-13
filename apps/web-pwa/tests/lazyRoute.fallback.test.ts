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

import { loadRouteWithFallback } from '../src/routes/lazyRoute.js';
import RouteLoadFailed from '../src/routes/RouteLoadFailed.svelte';

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

describe('RouteLoadFailed — inline fallback component', () => {
  it('renders a clear "couldn\'t load" message with a Retry affordance', () => {
    const { getByText, getByRole } = render(RouteLoadFailed);
    expect(getByText(/couldn't load this page/i)).toBeTruthy();
    const retry = getByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
    cleanup();
  });
});
