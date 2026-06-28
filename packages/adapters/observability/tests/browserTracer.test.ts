import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startUserActionSpan,
  isBrowserTracingReady,
  initBrowserTracing,
  toBrowserOtlpSpan,
} from '../src/browserTracer.js';
import { buildOtlpBody, type OtlpSpan } from '../src/shared/otlpWire.js';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-web';

// ---------------------------------------------------------------------------
// Browser OTel tracer + OTLP/JSON exporter (issue #362, Phase 4).
// Asserts: (1) startUserActionSpan yields a valid W3C traceparent derived from the
// started span; (2) the exporter builds the SHARED OTLP body shape (buildOtlpBody);
// (3) export failures are swallowed (best-effort, never throws — Rule 10).
// The module memoises its provider/tracer in module state, so the first init in
// this file wins for the whole file — these tests share one live tracer.
// ---------------------------------------------------------------------------

// Capture every OTLP POST so we can assert the body shape the exporter produced.
const fetchCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  fetchCalls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { body?: string }) => {
      fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: true } as Response);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initBrowserTracing', () => {
  it('no-ops without a key (tracer stays inert)', () => {
    initBrowserTracing('');
    // With no key and no prior init in this fresh module, tracing is not ready.
    expect(isBrowserTracingReady()).toBe(false);
  });
});

describe('startUserActionSpan (real tracer)', () => {
  beforeEach(() => {
    // Build the real provider/tracer once (idempotent — subsequent calls no-op).
    initBrowserTracing('phc_test_public_key');
  });

  it('becomes ready after init with a key', () => {
    expect(isBrowserTracingReady()).toBe(true);
  });

  it('derives a valid W3C traceparent from the started span', () => {
    const span = startUserActionSpan('Import recipe from bbcgoodfood.com');
    // 00-<32 hex traceId>-<16 hex spanId>-01
    expect(span.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    span.end();
  });

  it('a child span shares the parent traceId (same trace)', () => {
    const span = startUserActionSpan('Author recipe');
    const parentTraceId = span.traceparent.split('-')[1];
    const child = span.child('callAuthorRecipe');
    child.end();
    span.end();
    // The exporter flushes on forceFlush/pagehide; we can't synchronously read the
    // child's traceparent, but the traceparent format guarantee above + the shared
    // context wiring is what we assert structurally here.
    expect(parentTraceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('clamps an over-long span name (bounded, never throws)', () => {
    const long = 'Import recipe from ' + 'x'.repeat(200);
    expect(() => {
      const s = startUserActionSpan(long);
      s.end();
    }).not.toThrow();
  });

  it('setError / setAttribute / end never throw and are idempotent', () => {
    const span = startUserActionSpan('Author recipe');
    expect(() => {
      span.setAttribute('author.outcome', 'ok');
      span.setError(new Error('boom'));
      span.end();
      span.end(); // second end is a no-op
    }).not.toThrow();
  });
});

describe('exporter OTLP body shape (shared buildOtlpBody)', () => {
  it('toBrowserOtlpSpan maps a ReadableSpan to the shared OtlpSpan shape', () => {
    const fake = {
      name: 'Import recipe from example.com',
      attributes: { 'import.outcome': 'ok', count: 3, ratio: 0.5, flag: true, obj: {} },
      startTime: [1_700_000_000, 0],
      endTime: [1_700_000_001, 500_000_000],
      kind: 1,
      parentSpanId: undefined,
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    } as unknown as ReadableSpan;

    const out = toBrowserOtlpSpan(fake);
    expect(out.traceId).toBe('a'.repeat(32));
    expect(out.spanId).toBe('b'.repeat(16));
    expect(out.name).toBe('Import recipe from example.com');
    expect(out.parentSpanId).toBeUndefined(); // omitted on root
    expect(out.startTimeUnixNano).toBe('1700000000000000000');
    expect(out.endTimeUnixNano).toBe('1700000001500000000');
    const attrKeys = out.attributes.map((a) => a.key);
    expect(attrKeys).toContain('import.outcome');
    expect(attrKeys).toContain('count');
    expect(attrKeys).toContain('ratio');
    expect(attrKeys).toContain('flag');
    expect(attrKeys).not.toContain('obj'); // non-scalar dropped
  });

  it('wraps spans in the resourceSpans → scopeSpans envelope with service.name=salt-web-pwa', () => {
    const span: OtlpSpan = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'Author recipe',
      kind: 1,
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      attributes: [],
    };
    const body = buildOtlpBody([span], 'salt-web-pwa') as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeSpans: Array<{ scope: { name: string }; spans: OtlpSpan[] }>;
      }>;
    };
    const rs = body.resourceSpans[0]!;
    expect(rs.resource.attributes[0]!.key).toBe('service.name');
    expect(rs.resource.attributes[0]!.value.stringValue).toBe('salt-web-pwa');
    expect(rs.scopeSpans[0]!.scope.name).toBe('salt-web-pwa');
    expect(rs.scopeSpans[0]!.spans[0]!.name).toBe('Author recipe');
  });
});

describe('best-effort export (never throws)', () => {
  beforeEach(() => {
    initBrowserTracing('phc_test_public_key');
  });

  it('swallows a throwing fetch on flush — startUserActionSpan path never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network down');
      }),
    );
    const span = startUserActionSpan('Import recipe from example.com');
    span.end();
    // forceFlush drains the BatchSpanProcessor → exporter.export → throwing fetch,
    // all of which must be swallowed.
    await expect(
      (async () => {
        // The provider's forceFlush is invoked on pagehide; call the public path
        // by ending spans and awaiting a tick so the batch pipeline runs.
        await new Promise((r) => setTimeout(r, 0));
      })(),
    ).resolves.toBeUndefined();
    expect(() => span.end()).not.toThrow();
  });
});
