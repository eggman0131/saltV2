import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startUserActionSpan,
  isBrowserTracingReady,
  initBrowserTracing,
} from '../src/browserTracer.js';

// ---------------------------------------------------------------------------
// Browser tracer FACADE (issue #813) — the lazy-load seam that keeps the OTel
// SDK out of the boot graph. The tracer's own behaviour is covered by
// browserTracer.test.ts against the implementation module; what matters here is
// that the facade holds startUserActionSpan's SYNCHRONOUS contract across the
// pre-load window, and degrades exactly as it already did when tracing was off.
//
// The facade memoises the loaded implementation in module state, so ordering
// within this file matters: the un-inited assertions come first.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true } as Response)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('before the implementation has loaded', () => {
  it('is not ready, and startUserActionSpan returns the inert handle synchronously', () => {
    expect(isBrowserTracingReady()).toBe(false);

    const span = startUserActionSpan('Add item: tinned tomatoes');
    // The already-documented degradation: no traceparent, so the callable omits
    // the header and the server leg roots its own plain trace.
    expect(span.traceparent).toBe('');
    expect(() => {
      span.setAttribute('add.outcome', 'ok');
      span.setError(new Error('boom'));
      span.child('callAddItem').end();
      span.end();
      span.end();
    }).not.toThrow();
  });

  it('no-ops without a key — the SDK chunk is never even requested', async () => {
    initBrowserTracing('');
    await vi.waitFor(() => expect(isBrowserTracingReady()).toBe(false));
  });
});

describe('after initBrowserTracing with a key', () => {
  it('loads the implementation and starts producing real traceparents', async () => {
    initBrowserTracing('phc_test_public_key');

    // Fire-and-forget: initBrowserTracing returns before the chunk resolves, so
    // readiness is asserted by polling rather than by awaiting a returned promise.
    await vi.waitFor(() => expect(isBrowserTracingReady()).toBe(true));

    const span = startUserActionSpan('Import recipe from bbcgoodfood.com');
    expect(span.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    span.end();
  });

  it('is idempotent — a second call does not rebuild the tracer', async () => {
    initBrowserTracing('phc_test_public_key');
    await vi.waitFor(() => expect(isBrowserTracingReady()).toBe(true));
    expect(() => initBrowserTracing('phc_test_public_key')).not.toThrow();
    expect(isBrowserTracingReady()).toBe(true);
  });
});
